# A single peer — internal architecture as state machines

> Describes one peer (one account/authorization agent and its UI) as a set of
> cooperating state machines: a durable activity lifecycle, the workflow
> executors that drive it, and the event-fed UI projection. Inter-peer edges
> (social-graph topology) are in [`social-graph.md`](social-graph.md); this
> document is the inside of one peer.

> **One peer account now operates in several registry sets** (org-admin Phases
> 2–3): its own (personal context) plus one per org it administers (§7).
> "Inside one peer" therefore covers the org-context execution and events
> paths below, not only the personal one.

## 1. Layers

```
UI (Vue/Pinia store) — personal context (own webId) or an org context (administered org)
  │  RPC (JSON over POST /.sai/api, cookie-authed)     │  events (GET /.sai/events, NDJSON stream)
  ▼                                                     ▼
ApiHandler (RPC router)                          EventsHandler (stream)
  │  resolveContext → the user's own AA session, or   ▲  subscribes under the signed-in
  │  the org's own AA session (the org is the owner;  │  admin's own webId
  │  the admin only authenticates — fullAdminAccess)  │
  ▼                                                     │
Services (Authorization, ShareResource, RoleRegistry, AgentRegistry, DataRegistry)
  │  synchronous writes + PUT activity (into the org's Activity Registry in an org context)
  ▼
Activity Registry (append-only log — the outbox)
  ▼  container Add → WebhookChannel2023 (owner channel + one admin channel per admin)
ActivityWebhookHandler ──▶ ActivityEvents (EventBus, keyed by the channel's webId)
  │  owner channel: maps activityType → workflow;  admin channel: forwards only
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
| `services/Admin.ts` `addAdmin` / `removeAdmin` | `adminAuthorizationRecorded` / `adminAuthorizationRevoked` | AdminAuthorization create/delete (synchronous, §7) |

The producer PUTs into the registry set the request operates in — the **org's**
Activity Registry in an org context (§7), with the org as the activity's `webId`
owner.

### Consumers (execute pending → done)

| activityType | Workflow | Queue |
|---|---|---|
| `authorizationRecorded` / `authorizationRevoked` | per-grantee consumer `processGranteeActivities` (drain + coalesce + mark done) | `create-grants` |
| `roleMembershipChanged` / `roleDeleted` | `processRoleMembershipChange` / `processRoleDeletion` (pre-deletion usage scan) | `create-grants` |
| `agentRegistrationAdded` | `establishReciprocal` (explicit retry: 5s→60s, ≤10 attempts; then mark done) | `reciprocal-registration` |
| `delegatedGrantsUpdated` | `updateDelegatedGrants` | `create-grants` |
| `adminAuthorizationRecorded` | `createAdminGrants` + `syncAdminAcr` (parallel) | `create-grants` |
| `adminAuthorizationRevoked` | `revokeAdminGrants` + `syncAdminAcr` (parallel) | `create-grants` |

Admin activities are dispatched by the **org's owner channel**; admin channels
never dispatch (§7) — the org's AA runs the org's workflows (C2).

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
6. UI `events.ts` maps `done(activityType)` → list refetches: `authorizationRecorded` → `listApplications`/`listSocialAgents` by grantee type; `role*` → `listSocialAgents`+`listRoles`; `agentRegistrationAdded` → `listSocialAgents`+invitations; `delegatedGrantsUpdated` → `listSocialAgents`; org-admin `adminAuthorizationRecorded`/`adminAuthorizationRevoked` → `listSocialAgents` (refresh is context-scoped — §7).

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
- **Owner vs admin channels (org context, R3).** The same handler serves the owner's channel and, per administered org, one **admin channel per admin** on the org's Activity Registry. A channel whose webId owns the topic's Activity Registry (`session.registrySet.hasActivityRegistry?.id === channel.topic`) is the owner channel — forwards **and** dispatches workflows. Any other channel is an admin channel — **forward-only** (no workflow dispatch; the org's owner subscription keeps running them). Both forward via `onActivityAdded(channel.webId, …)`, so an admin channel delivers org-context `pending`/`done` to the **admin's** stream, keyed by the admin's own webId.
- **Context-scoped UI refresh.** `events.ts` refreshes only when the activity's registry owner (`payload.webId`, present on every activity) equals the current context — org events refresh org-context views while the user operates in that org; switching contexts performs a full refresh.
- `EventsHandler` registers/unregisters the browser stream under `webIdLinks[0]`, writes an initial heartbeat to flush headers, clears on close/abort.
- Writes are fire-and-forget (bounded buffer); a slow/stuck stream must never delay the webhook response.

## 6. Where the state-machine view is leaky (accepted)

1. **No `failed`/dead-letter state** — permanent workflow failure leaves the activity `pending` forever; `reconcileActivities` is the (currently unscheduled) reprocessing backstop.
2. **`done` without `pending`** — ordering is not guaranteed; `done` is authoritative.
3. **Duplicate `done`s** — concurrent completers (consumer + sweep) may both ack; harmless (idempotent), but possibly redundant UI refetches (future coalescing).
4. **Store staleness is implicit** — no explicit `stale/fresh` flag; compensated by snapshot resync on connect/reconnect/mount.
5. **`agentRegistrationAdded` stuck-pending on permanent failure** — the sweep skips it (no `accountId` in its payload); the events stream just never emits `done` (UI heals via refetch).
6. **`GrantIssuanceHandler` exempt** — the data-owner side of delegated-grant issuance starts `storeGrant` directly; no activity, so the data owner's UI gets no `pending`/`done` event (see social-graph.md §5).

## 7. Org context — one peer, many registry sets (org-admin Phases 2–3)

The signed-in user operates in a **context**: their personal context (own
webId/registry set) or an **organization context** for each org they
administer. One UI/session therefore touches the user's own registries *and*
every org's — "one peer = one registry set" no longer holds.

- **Resolution.** RPCs carry a required `context` webId; `ApiHandler` runs
  every context-bearing service through `resolveContext`
  (`packages/components/src/services/Context.ts`): the personal context is
  always allowed; an org context requires the **admin marker** (the org's
  registration of the user — the reciprocal, carrying a non-empty
  `hasAdminGrant` link), then resolves the org's RegistrySet IRI via the
  admin-only `hasRegistrySet` Link header on the org's agent-id doc (§2.4/2.8)
  and builds the **org's own AA session** (`SessionManager.getSession(org,
  registrySetId)`).
- **Owner identity = the org (C1).** In an org context every record is written
  with the **org** as data owner / `grantedBy` / ACR `fullOwnerAccess` /
  activity `webId` — the admin only *authenticates*. Writes carry
  `{ agent: org, client: the admin's UAS }`; the ACP matcher that admits them
  is the org's `#fullAdminAccess` (matchers rewritten from the admin list by
  `syncAdminAcr`). Sessions are short-lived (per request / per Temporal
  activity) and hold the webId-keyed registry-set map — the user's own is
  eager-loaded, every org's is lazy-resolved on demand; no cross-request
  cache to invalidate (C2).
- **Outbox & events ownership (R3).** Org-context activities land in the
  **org's** Activity Registry and are processed by the **org's**
  AA/workflows; on the owner channel their `pending`/`done` are keyed by the
  *org* webId — not the admin's stream. The admin UI learns org-context
  workflow outcomes through **admin webhook channels**: one CSS
  `WebhookChannel2023` + `ActivityWebhookStore` entry per (admin, org) on the
  org's Activity Registry, `webId` = the admin, `topic` = the org's Activity
  Registry (§5). `ActivityWebhookHandler` recognizes them by the ownership
  check and **forwards only**, keyed by the admin's webId, so org events
  surface on the admin's own `/.sai/events` stream alongside personal events.
  This **supplements — does not replace** — the `delegatedGrantsUpdated`
  reciprocal refresh (§2), which still carries the admin's *own* admin-status
  changes (the promotion/revocation PATCH on the org's registration of them).
  Dev/test pre-seed both channel kinds in `environments/data/kv.json`;
  runtime creation/removal of admin channels rides the admin-grant workflows
  (`webhook-subscription-bootstrap.md` §4.6).
- **UI refresh is context-scoped (§3.3).** `events.ts` maps `done` → refetches
  only when the activity's registry owner (`payload.webId`) equals the
  current context; `switchContext` performs a full refresh.
