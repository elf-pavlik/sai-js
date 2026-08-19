# A single peer — internal architecture as state machines

> Describes one peer (one account/authorization agent and its UI) as a set of
> cooperating state machines: a durable activity lifecycle, the workflow
> executors that drive it, and the event-fed UI projection. Inter-peer edges
> (social-graph topology) are in [`social-graph.md`](social-graph.md); this
> document is the inside of one peer.

## 1. Layers

```
UI (Vue/Pinia store)
  │  RPC (JSON over POST /.sai/api, cookie-authed)     │  events (GET /.sai/events, NDJSON stream)
  ▼                                                     ▼
ApiHandler (RPC router)                          EventsHandler (stream)
  │                                                     ▲
  ▼                                                     │
Services (Authorization, ShareResource, RoleRegistry, AgentRegistry, DataRegistry)
  │  synchronous writes + PUT activity
  ▼
Activity Registry (append-only log — the outbox)
  ▼  container Add → WebhookChannel2023 (own registry, pre-seeded channel)
ActivityWebhookHandler ──▶ ActivityEvents (EventBus, keyed by webId)
  │  maps activityType → workflow
  ▼
Temporal workflows (create-grants / reciprocal-registration queues)
  │  on success: markActivitiesDone → PUT completion activity (activityCompleted, target = activity IRI)
  ▼
Activity Registry ← completion Add → ActivityWebhookHandler → ActivityEvents → browser stream → UI refetch
```

The RPC contract lives in `packages/api-messages` (effect Schema + `@effect/rpc`
router: `GetWebId`, `ListSocialAgents`, `AuthorizeApp`, `ShareResource`,
`UpdateRole`, `DeleteRole`, `CreateInvitation`, …). `ApiHandler` resolves
identity from the account cookie (`accountId` → `webIdLinks[0]` → session) and
executes the router against the service layer through a `SaiService` context.

## 2. The central state machine — activity lifecycle

**The Activity Registry is an append-only log** (immutable-activities.md).
State is never mutated; a transition is a new log entry.

```
                 producer PUT            workflow success (markActivitiesDone)
   ∅ ──────────────────────────────▶ pending ───────────────────────────────▶ done
        (change activity, container Add)    │            (completion activity, container Add)
                                            │
                                            └─ permanent failure: STAYS pending (no dead-letter,
                                               accepted; "done never requires a prior pending")
```

- **`pending`** = a change activity (`activityType !== 'activityCompleted'`) with no completion referencing it.
- **`done`** = a `activityCompleted` whose `target` = the activity IRI exists (derived by scanning the log).
- **Both transitions are container `Add`s** on the same pre-seeded webhook channel → one signal source; no per-activity subscriptions, no polling, no replay.
- **`done` is authoritative without a prior `pending`** (the change `Add` may be missed while connected) — correlation is via the completion's `target`.

### Producers (write transitions)

| Producer (`createActivity`) | activityType | synchronous writes done before/with the PUT |
|---|---|---|
| `services/Authorization.ts` `recordAuthorization` | `authorizationRecorded` | data authorizations, application registration |
| `services/ShareResource.ts` `shareResource` | `authorizationRecorded` (one per deduped grantee) | data-instance sharing |
| `services/RoleRegistry.ts` `updateRole` / `deleteRole` | `roleMembershipChanged` / `roleDeleted` | role resource mutation (only if affected members) |
| `InvitationHandler` | `agentRegistrationAdded` | invitee registration |
| `ReciprocalWebhookHandler` (peer `Update`) | `delegatedGrantsUpdated` | — (peer-driven; own registration PATCH) |

### Consumers (execute pending → done)

| activityType | Workflow | Queue |
|---|---|---|
| `authorizationRecorded` / `authorizationRevoked` | per-grantee consumer `processGranteeActivities` (drain + coalesce + mark done) | `create-grants` |
| `roleMembershipChanged` / `roleDeleted` | `processRoleMembershipChange` / `processRoleDeletion` (pre-deletion usage scan) | `create-grants` |
| `agentRegistrationAdded` | `establishReciprocal` (explicit retry: 5s→60s, ≤10 attempts; then mark done) | `reciprocal-registration` |
| `delegatedGrantsUpdated` | `updateDelegatedGrants` | `create-grants` |

The grant regeneration pipeline is **idempotent by construction** (full
re-derivation from authorizations + single-PATCH `replaceDataGrantsOnRegistration`),
which lets `reconcileActivities` (the sweep backstop) safely re-enter any
`pending → done` transition.

## 3. The full arc (one example: `AuthorizeApp`)

1. UI submits → `effect.authorizeApp(authorization)` (RPC).
2. `ApiHandler`: cookie → webId → session; `recordAuthorization` writes authorizations + registration, PUTs the `authorizationRecorded` activity, **returns the recorded authorizations** — the RPC resolves with *intent committed*, not outcome.
3. Container `Add` → `ActivityWebhookHandler`: loads the activity, emits `pending` to the `ActivityEvents` bus, routes to the per-grantee consumer (start-or-signal, deterministic `workflowId grantee:{webId}:{grantee}`).
4. Consumer drains → `createGrantsForAgent` per grantee (store grants + ACRs, request delegations, PATCH registration) → `markActivitiesDone` → completion PUT.
5. Completion `Add` → webhook handler loads the completed activity via `target`, emits `done` (enriched with the original `activityType`/`payload`).
6. UI `events.ts` maps `done(activityType)` → list refetches: `authorizationRecorded` → `listApplications`/`listSocialAgents` by grantee type; `role*` → `listSocialAgents`+`listRoles`; `agentRegistrationAdded` → `listSocialAgents`+invitations; `delegatedGrantsUpdated` → `listSocialAgents`.

## 4. UI-side machines

**Event-stream connection** (`ui/authorization/src/events.ts`):

```
 stopped → connecting → open ⇄ (error | heartbeat-timeout > 90s) → reconnecting (backoff 1s→30s)
```

- `→ open` fires a **full store refresh** (snapshot resync — the server never replays).
- Heartbeats every ~30s (`EventsHandler`, `EVENTS_HEARTBEAT_INTERVAL_MS`); the watchdog aborts on timeout; reconnect with exponential backoff.

**Store freshness (soft machine, per list)** — the Pinia store
(`store/app.ts`) is a cache with a `force` bit; three explicit refresh kinds:

| Kind | Trigger | Covers |
|---|---|---|
| Synchronous | right after the RPC returns | what the service already mutated before returning (role resource, registrations) |
| Completion-driven | `done` event → targeted refetch by activityType | async workflow outcomes (grant state) — **list-level, not item-level** |
| Baseline | view mount + `events.ts` full refresh on (re)connect | no-event changes (`storeGrant` exempt, data instances, missed-while-disconnected) |

## 5. EventBus

`ActivityEvents` (`packages/components/src/ActivityEvents.ts`) — in-memory
`WrappedSetMultiMap<webId, PassThrough>`, a StreamingHttpMap mirror:

- `ActivityWebhookHandler` forwards every activity `Add` (`pending`) and every completion `Add` (`done`, enriched) via `onActivityAdded(channel.webId, …)` **before** dispatch (so grantee activities, which return early, are covered).
- `EventsHandler` registers/unregisters the browser stream under `webIdLinks[0]`, writes an initial heartbeat to flush headers, clears on close/abort.
- Writes are fire-and-forget (bounded buffer); a slow/stuck stream must never delay the webhook response.

## 6. Where the state-machine view is leaky (accepted)

1. **No `failed`/dead-letter state** — permanent workflow failure leaves the activity `pending` forever; `reconcileActivities` is the (currently unscheduled) reprocessing backstop.
2. **`done` without `pending`** — ordering is not guaranteed; `done` is authoritative.
3. **Duplicate `done`s** — concurrent completers (consumer + sweep) may both ack; harmless (idempotent), but possibly redundant UI refetches (future coalescing).
4. **Store staleness is implicit** — no explicit `stale/fresh` flag; compensated by snapshot resync on connect/reconnect/mount.
5. **`agentRegistrationAdded` stuck-pending on permanent failure** — the sweep skips it (no `accountId` in its payload); the events stream just never emits `done` (UI heals via refetch).
6. **`GrantIssuanceHandler` exempt** — the data-owner side of delegated-grant issuance starts `storeGrant` directly; no activity, so the data owner's UI gets no `pending`/`done` event (see social-graph.md §5).
