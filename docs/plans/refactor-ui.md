# UI sync via `/.sai/events` — keep the store in sync with webhook-triggered workflows

> **Status:** ✅ done — implemented (commit `240bb321 [ui] refactor`).
> Since `workflow-temporal-decupling.md`, the RPCs
> (`AuthorizeApp`, `ShareResource`, `UpdateRole`, `DeleteRole`, invitation)
> only PUT an activity to the Activity Registry and return; the workflow runs
> later (CSS `Add` → `ActivityWebhookHandler` → Temporal → single-PATCH
> registration `Update`). The UI's eager post-RPC refetches in
> `store/app.ts` therefore observe **stale** grant-dependent state.
> This plan adds an always-open NDJSON event stream (`/.sai/events`) that the
> UI keeps open, driven by the activity lifecycle (`pending` → `done`) via an
> **EventBus modeled on CSS's `StreamingHttpChannel2023`/`StreamingHttpMap`**,
> **reusing the existing pre-seeded Activity Registry webhook channel** for the
> `Add` signal. Decided: (1) `agentRegistrationAdded` activities are marked
> `done`; (2) `updateDelegatedGrants` becomes an activity producer (pending →
> done); (3) coalescing and (4) multiple tabs are future improvements.
> **Pre-requisite:** [`immutable-activities.md`](immutable-activities.md) — the
> Activity Registry becomes an append-only log; `done` = a minimal **completion
> activity** (`activityType: 'activityCompleted'`, `target` = the completed
> activity IRI) delivered as a container `Add`.

---

## 1. Problem

- Producers now write an activity and return. The workflow — and the
  observable outcome (grants, registration `hasDataGrant`) — happens
  asynchronously, signaled by a **completion activity** PUT into the Activity
  Registry (`markActivitiesDone` → `createCompletion`, one `activityCompleted`
  per activity — see [`immutable-activities.md`](immutable-activities.md)).
- `ui/authorization/src/store/app.ts` keeps state fresh by refetching
  immediately after the RPC resolves: `authorizeApp` →
  `listApplications(true)` + `listSocialAgents(true)` + `listRoles(true)`;
  `updateRole`/`deleteRole` → `listRoles(true)`; `shareResource` → nothing.
  All of these run **before** the workflow, so grant-dependent UI is stale:
  - `views/SocialAgentList.vue` — `accessGrant` badge (never refreshed, and
    `buildSocialAgentProfile` never populates `accessGrant` at all).
  - `components/ShareResource.vue` — `resource.accessGrantedTo` computed at
    read time from grants (`findSocialAgentsWithAccess`).
  - `views/Role.vue` — member grants after `UpdateRole`/`DeleteRole`.
- The push path (`Dashboard.vue` `navigator.serviceWorker.onmessage` →
  refresh lists) is dead: `sendPushNotifications`
  (`temporal/workflows/forward-to-push.ts`) has **no caller**.

The fix is a notification-driven sync mirroring `test/util.ts`
(`openNotificationStream` / `awaitNotification`), but **server-mediated**: the
browser has no session on the registry server (`reg.docker` is
DPoP-bearer-auth; all registry access goes through the RPC handler with the
account-cookie session), so the event stream lives on the auth server.

## 2. Signal source — the activity lifecycle (`pending` → `done`)

> **Pre-requisite:** [`immutable-activities.md`](immutable-activities.md) — the
> Activity Registry is an append-only log; completing an activity PUTs a
> minimal **completion activity** (`activityType: 'activityCompleted'`,
> `target` = the completed activity IRI) into the same container. "Pending" =
> a change activity with no completion referencing it.

| Stage | Who | Notification |
|---|---|---|
| change activity PUT | producer service (`recordAuthorization`, `shareResource`, `updateRole`, `deleteRole`, `InvitationHandler`) | container `Add` → `ActivityWebhookHandler` |
| workflow runs | `ActivityWebhookHandler` → Temporal | — |
| completion PUT | `markActivitiesDone` → `createCompletion` (one `activityCompleted` per activity) | container `Add` → `ActivityWebhookHandler` |

One fact and one decision shape the design:

1. **The container webhook channel is the only signal source.** Both the
   change `Add` and the completion `Add` are delivered to the same pre-seeded
   channel (§3.4 of the decoupling plan) — no per-activity subscriptions, no
   inter-server streaming, no status re-reads, no replay.
2. **Race (benign).** The completion `Add` can arrive before the UI sees the
   change `Add` (or without it, if the change `Add` was missed). The UI must
   treat each event independently and correlate via `target` — `done` never
   requires a preceding `pending`.

## 3. Architecture — EventBus (StreamingHttpMap-style) + `/.sai/events`

Mirror of CSS: `StreamingHttpChannel2023` keeps a
`StreamingHttpMap extends WrappedSetMultiMap<string, PassThrough>` — topic →
set of open streams; the emitter writes each notification to every stream
registered for the topic. We build the same for the UI:

- **`ActivityEvents` service** (new, Components.js singleton, in-memory): a
  `WrappedSetMultiMap<string, PassThrough>` keyed by **webId** — the account's
  first linked webId (`webIdLinks[0]`), resolved exactly like `ApiHandler`
  (see §7 for the "for now" caveat). Methods:
  `subscribe(webId, stream)` / `unsubscribe(webId, stream)`,
  `onActivityAdded(webId, activity)`, `emit(webId, line)`.
- **Event sources** write NDJSON lines to every stream under the webId:
  1. **change `Add` — reuse the existing container webhook.** The pre-seeded
     container channel already delivers every change `Add` to
     `ActivityWebhookHandler`, which already loads the activity. Extend it:
     after loading, push `{"type":"activity",...,"status":"pending"}` under
     `channel.webId`. No new registry subscription.
  2. **completion `Add` — the `done` signal.** The same handler receives the
     `activityCompleted` `Add` (immutable-activities.md). It must not start a
     workflow (`activityCompleted` is not in the routing map — falls through
     today); for the bus it loads the **completed** activity via `target` and
     emits `{"type":"activity",...,"status":"done"}` enriched with the
     original's `activityType`/`payload` (the completion resource itself is
     minimal — no payload). UI correlation: `target` = the completed activity
     IRI.
  3. **No replay.** The stream only carries events that happen *after* the
     connection is open. A missed delivery (change or completion `Add` while
     disconnected) is healed by the UI's **full refetch on (re)connect**
     (§5) — nothing is replayed by the server, so the append-only log never
     needs to be listed on connect.
- **`EventsHandler`** (`GET /.sai/events`): resolve the webId from the
  account cookie exactly like `ApiHandler` (`cookieStore` →
  `webIdStore.findLinks(accountId)` → `webIdLinks[0]`); create a
  `PassThrough`, register it under that webId; write
  `{"type":"heartbeat"}` every ~30s; on request close/abort unregister.
  Response
  via `ResponseDescription` with a `Guarded<Readable>` body — the same pattern
  CSS's own `StreamingHttpRequestHandler` uses.

### Event format (NDJSON, one JSON object per line)

```ndjson
{"type":"activity","activity":{"id":"…","activityType":"authorizationRecorded","target":"…","payload":{…},"status":"pending","createdAt":"…"}}
{"type":"activity","activity":{…,"status":"done"}}
{"type":"heartbeat"}
```

The UI needs nothing else: `activityType` + `payload` say *what* changed,
`status` says *when it's safe to refetch*.

## 4. Server changes (phased — green suite after every phase)

### Phase 0 — mark every activity `done` (so `done` is a complete signal)

**Step 0.1 — `agentRegistrationAdded` marked done.**

- `ActivityWebhookHandler`: pass `activityIri` for **all** types — today
  `agentRegistrationAdded` gets `{ accountId, ...payload }` without
  `activityIri`; change to `{ accountId, ...payload, activityIri }`.
- `establishReciprocal` (`temporal/workflows/reciprocal.ts`): add
  `activityIri?: string` to `ReciprocalRegistrationInput`; after
  `reciprocalWebhook(result)` succeeds, call `markActivitiesDone({ webId,
  activities: [{ id: activityIri }] })` (guard on `activityIri`).
- `temporal/workflows/reciprocal.ts` (workflow, sandboxed): declare the
  activity stub — add a second `proxyActivities<typeof grantsActivities>` set
  (destructure `markActivitiesDone` from it) alongside the existing
  `reciprocalActivities` proxy. Workflows can only call activities they proxy;
  `markActivitiesDone` lives in `temporal/activities/grants.js`, so the stub
  must be declared here before `establishReciprocal` can call it. No
  `taskQueue` option needed: a proxied activity without one routes to the
  workflow's own queue (`reciprocal-registration`), where the activity will
  now be registered.
- `workers/main.ts`: register `grantsActivities` on the `reciprocal-registration`
  worker too (currently only `reciprocalActivities`; `WorkerOptions.activities`
  is a **single object**, so spread both:
  `activities: { ...reciprocalActivities, ...grantsActivities }`) so
  `markActivitiesDone` is available there. (The two modules export disjoint
  names — reciprocal: `reciprocalRegistration`/`reciprocalWebhook`; grants:
  `markActivitiesDone` et al. — no spread collision.)

**Step 0.2 — `updateDelegatedGrants` becomes an activity producer.**

- `ReciprocalWebhookHandler`: inject `sessionManager`; on `Update`, instead of
  starting `updateDelegatedGrants` directly, **PUT** a `delegatedGrantsUpdated`
  activity (`ActivityRegistry.createActivity`, **`target` = the peer's webId
  (`channel.peerId`) — the side whose reciprocal-registration `Update`
  triggered this webhook; informational only, like other `target`s it is not
  consumed by any workflow** — payload
  `{ webId: {id: channel.webId, …}, peerId: {id: channel.peerId, …} }` — the
  ready-made `updateDelegatedGrants` input). The container `Add` then routes
  through the same `ActivityWebhookHandler` path as every other producer.
- `ActivityWebhookHandler`: add mapping
  `delegatedGrantsUpdated → updateDelegatedGrants` (`create-grants` queue).
  It joins the generic branch that already injects `activityIri`.
- `updateDelegatedGrants` (`temporal/workflows/grants.ts`): add
  `activityIri?: string` to `FindAffectedAuthorizationsInput`; after
  `findAffectedGrantees` + child workflows, call `markActivitiesDone` (guard on
  `activityIri`).
- `reconcileActivities` sweep: handle `delegatedGrantsUpdated` (run
  `updateDelegatedGrants` + mark done) — its payload (`webId`, `peerId`) is
  resolvable here, unlike `agentRegistrationAdded`. This is the backstop for a
  missed `Add` delivery on the reciprocal path (which today starts the
  workflow synchronously — see note).

> **Note (deviation from the decoupling pillar).** "Only admin agents write
> activities" — the reciprocal handler runs as the main agent and now writes
> its own outbox. This is one-shot and loop-free (workflows never PUT
> activities; the container webhook fires only on `Add`, and
> `updateDelegatedGrants`' own writes are grants/registration PATCHes). The
> rationale is a **uniform outbox**: the UI gets a `done` event for
> peer-driven updates too. Reliability of the reciprocal trigger now depends on
> the same fire-and-forget `Add` delivery as every other producer — accepted
> (sweep backstop + durable delivery Phase 4.3 of the decoupling plan).

- **Tests:** extend `reciprocal-webhook.test.ts` and `invitation.test.ts` to
  assert a **completion activity** exists for the triggering activity — using
  the new `test/util.ts` events-stream helper (open `/.sai/events` with the
  account cookie, await the `done` line for the activity IRI; §7) or by
  reading the registry.
- **Gate:** `pnpm test` + `pnpm typecheck` green.

### Phase 1 — `ActivityEvents` (EventBus + webhook forwarding)

- New `packages/components/src/ActivityEvents.ts`: the
  `WrappedSetMultiMap<string, PassThrough>` bus, `subscribe`/`unsubscribe`,
  `onActivityAdded(webId, activity)`, `emit(webId, line)`.
- `ActivityWebhookHandler`: inject `ActivityEvents`; **restructure so the bus
  emit happens before dispatch — today the grantee branch
  (`authorizationRecorded`/`authorizationRevoked`) returns 200 early, so an
  emit added only at the bottom would skip exactly those activities**: after
  loading the activity, push to the bus under `channel.webId` in one place
  every `Add` passes through: change activities → `status: 'pending'`;
  `activityCompleted` → load the completed activity via `target` →
  `status: 'done'` (enriched with the original's `activityType`/`payload`).
  Then dispatch as today (grantee start-or-signal branch, routing map).
  `activityCompleted` never routes to a workflow.
- Config: define `urn:sai:default:ActivityEvents` in
  `packages/components/config/storage/account.json` (alongside the existing
  stores); wire it into `ActivityWebhookHandler` in
  `packages/components/config/http/handler/default.json`. No new route — the
  existing `^/.sai/activity-webhook/.*` channel delivers both `Add`s.
- **Gate:** green (behavior-neutral — the bus has no consumers yet).

### Phase 2 — `EventsHandler` (`/.sai/events`)

- New `packages/components/src/EventsHandler.ts` (OperationHttpHandler):
  webId from cookie (`cookieStore` → `webIdStore` → `webIdLinks[0]`) →
  register stream → heartbeat → cleanup. Metadata:
  `Content-Type: application/x-ndjson`, `Cache-Control: no-store`.
- Route in `packages/components/config/http/handler/default.json` (add to the
  `RestRouter` waterfall): `OperationRouterHandler`,
  `allowedPathNames: ["^/.sai/events$"]`, `allowedMethods: ["GET"]`, handler
  `EventsHandler` with `cookieStore`, `webIdStore`,
  `activityEvents`. Shared by dev (`environments/css/auth.json` →
  `sai:config/auth.json`) and test (`environments/css/https/auth.json`) — no
  environment-specific changes.
- **Gate:** green + manual dev verification (`curl -N
  https://auth.docker/.sai/events` with the account cookie shows heartbeats;
  an RPC from the UI should produce `pending`/`done` lines).

## 5. UI changes (Phase 3)

Three kinds of refresh, explicitly split:

- **Synchronous — unchanged from today.** What the RPC already changed
  *before* returning does not need the events stream:
  - `updateRole` / `deleteRole` mutate the role resource synchronously → keep
    `listRoles(true)` right after the RPC.
  - `authorizeApp` creates the application/social-agent **registration**
    synchronously inside `recordAuthorization` (before the activity PUT) →
    keep the post-RPC registration-level refetch (or rely on the destination
    view's mount refetch). Only the *grant set* is async.
- **Completion-driven — the events stream.** Only async workflow outcomes
  (grant state) are refreshed on `status: 'done'` events, by mapping the
  **completed activity's type** (the events service enriches
  `activityCompleted` with the original's `activityType` + `payload`):

  | completed activity type | refresh |
  |---|---|
  | `authorizationRecorded` / `authorizationRevoked` | grantee social agent/role → `listSocialAgents(true)`; grantee application → `listApplications(true)` |
  | `roleMembershipChanged` / `roleDeleted` | `listSocialAgents(true)` (+ `listRoles(true)` — synchronous anyway) |
  | `agentRegistrationAdded` | `listSocialAgents(true)` / `listSocialAgentInvitations(true)` |
  | `delegatedGrantsUpdated` | `listSocialAgents(true)` |

  This mapping is **list-level, not item-level**: the events cannot tell the
  UI *which* member (when the grantee is a role) changed — coarse refetches
  absorb that. Optionally use `pending` events for a "applying changes…"
  indicator.
- **Mount-time baseline — unchanged.** Views already refetch on mount
  (`listSocialAgents()` etc.); this covers what no event signals: `storeGrant`
  (exempt), data-instance lists, peer-side data on revisit.
- **Reconnect baseline — new.** The stream carries no replay (§3): on first
  connect and on every reconnect, `events.ts` triggers a full store refresh
  (`listSocialAgents(true)` + `listApplications(true)` + `listRoles(true)` +
  `listSocialAgentInvitations(true)`), so anything missed while disconnected
  is re-fetched; live events then drive the granular refreshes above.

- **`ui/authorization/src/events.ts`** (new): connect to
  `${getRuntimeConfig().backendBaseUrl}/.sai/events` with
  `credentials: 'include'` (plain fetch, like the account calls in
  `store/core.ts`); read the body with a reader, split on `\n`, parse NDJSON,
  dispatch; **auto-reconnect with backoff** on error/close; heartbeat-timeout
  detection; connect after sign-in (`coreStore.userId` set), close on
  sign-out; on first open and every reconnect trigger the full store refresh
  (§5 — Reconnect baseline).
- **Server (same phase):** `buildSocialAgentProfile`
  (`packages/components/src/services/AgentRegistry.ts`) populates
  `accessGrant` from the grantor-side registration's `hasDataGrant`
  (`getDataGrantIris`) — without this the `SocialAgentList` badge stays broken
  even once refreshes land.
- **Gate:** `pnpm test` + `pnpm typecheck` green; manual dev verification:
  `AuthorizeApp` / `ShareResource` / `UpdateRole` / `DeleteRole` and watch the
  lists update a moment after the RPC, driven by the events stream.

## 6. Future improvements (explicitly out of scope now)

- **Coalescing.** `processGranteeActivities` marks a whole drained batch
  `done` together → the UI may receive several `done` events for the same
  grantee in one tick; dedupe/refresh once per tick per grantee.
- **Multiple tabs.** Each tab opens its own `/.sai/events` connection (own
  server-side subscription). Share one connection across tabs via
  `BroadcastChannel`/`SharedWorker`.
- **Non-activity events.** `storeGrant` (exempt) and any change without an
  activity produce no events; views already refetch on mount, so this is
  acceptable today. If needed later, the bus can also carry registration
  `Update`s (topic = agent registry container).

## 7. Open questions

- **EventBus multi-instance.** The bus is an in-memory Components.js
  singleton; single auth-server instance today (dev docker-compose, dagger).
  If the auth server ever scales out, events only reach UIs connected to the
  same instance — future option: Postgres `LISTEN/NOTIFY` or the kv store.
- **`authorizationRevoked` is not yet produced.** `recordAuthorization`
  currently always PUTs `authorizationRecorded` (deny included); the events
  mapping is future-ready only (`authorization-revoked.md`).
- **`agentRegistrationAdded` stuck-pending on permanent failure. — decided:
  accept.** `establishReciprocal` retries then fails; the activity stays
  `pending` and the sweep can't reprocess it (no `accountId`). Accepted:
  no replay means the events stream is unaffected (the activity just never
  emits `done`; UI heals via mount/reconnect refetches) and the sweep skips
  it today anyway. Future option: let the sweep resolve `accountId` via the
  webId store.
- **Reciprocal trigger reliability window. — decided: accept.** Routing
  `updateDelegatedGrants` through the outbox makes it depend on the
  fire-and-forget `Add` delivery, and `reconcileActivities` (the backstop)
  has no caller/schedule in the codebase today — this is a pre-existing gap
  for **all** producers, and Phase 0.2 turns it into a regression risk only
  on a path that was previously synchronous. Accepted for now: consistent
  with every other producer; a scheduled sweep can be added later (decoupling
  plan Phase 3).
- **WebId resolution — decided: `webIdLinks[0]`, for now.** The bus is keyed
  by the account's **first linked webId**, resolved exactly like `ApiHandler`
  (`cookieStore` → `webIdStore.findLinks(accountId)` → `webIdLinks[0]`), and
  the webhook handler forwards under `channel.webId`. This assumes the two
  agree — true in the seeded dev/test setup (both come from the same kv data
  through the same mapping). If they ever diverge (an account links a
  different webId later, or a runtime-created channel uses a different form),
  revisit — the robust alternative was keying by `accountId` (opaque, never
  host-mapped, per-account scope).
- **Event ordering.** There is no replay — the stream only carries live
  events; a `done` can arrive without a preceding `pending` (the change `Add`
  was missed by the emitter while connected). The UI must treat
  `status: 'done'` as authoritative (no requirement of a prior `pending`).
- **Dagger E2E for the events endpoint — decided: add a test.** The test
  stack exercises the stream directly: a new helper in `test/util.ts` opens
  `https://auth/.sai/events` with an account cookie (tests already POST RPCs
  with cookies), parses NDJSON lines, and awaits a `done` line for an activity
  IRI. The helper is also used in the existing tests that already run
  workflows and check completions (`reconciliation.test.ts`, and the Phase-0
  additions in `reciprocal-webhook.test.ts` / `invitation.test.ts`) — instead
  of (or in addition to) reading the registry, they await the `done` event
  from the stream.
- **Share resource IRI — resolved: not needed.** The shared resource IRI is
  deliberately **not** added to the share activity. The user's own share
  redirects away from the ShareResource view immediately (`callbackEndpoint`),
  and returning later is covered by the mount-time refetch of `getResource`.
  The completion-driven refresh targets only registration-level state
  (`listSocialAgents`); live updates matter for changes the user didn't
  trigger in the current view (peer-driven, other admins, other tabs), none of
  which need the resource IRI. `target` stays informational (the authorization
  registry) and is not consumed by any workflow.

## Notes (resolved / implementation)

- **CORS on the streaming GET** — resolved: the auth server runs CSS's default
  `CorsHandler` middleware on every request (`credentials: true`, reflects the
  Origin), so the `/.sai/events` response gets the same headers as the RPC.
- **No server-to-server streaming, no token-lifetime issue** — all registry
  notification delivery is WebhookChannel2023 POSTs; subscribe/unsubscribe are
  short-lived POSTs with a per-call self-issued session; the browser
  connection is cookie-authed. The 1h self-issued-token expiry never applies
  to a long-lived connection.
- **Registry is append-only (immutable-activities.md)** — no per-activity
  subscriptions, no status re-reads, no replay; the completion `Add` is the
  `done` signal; a missed delivery is healed by the UI's full refetch on
  (re)connect.
- **Non-blocking forward.** The webhook handler both starts workflows and
  writes to the bus; a slow/stuck UI stream must never delay the webhook
  response — bounded buffer / fire-and-forget write on the bus side.
- **Buffering:** ensure the response is chunked and not buffered by traefik
  (`Transfer-Encoding: chunked`; add `X-Accel-Buffering: no` if needed).
- The endpoint is per-account (cookie); the session is resolved once per
  connection, not per event.
- Tests: existing `test/*` synchronization is unchanged (they watch the
  registration `Update`); `ActivityEvents` gets unit tests; the events
  endpoint gets a dagger test via the new `test/util.ts` helper (§7).
- **No-channel / no-registry-set accounts.** Until the bootstrap creates the
  container webhook channel (decoupling plan Phase 3), a fresh account gets
  **no live events** — with no replay, the UI simply falls back to
  mount/reconnect refetches (still correct, just not live).
- The push path (`sendPushNotifications` / `Dashboard.vue` `onmessage`) is
  **out of scope for this pass** — not touched; it remains as-is. The events
  stream supersedes it for UI refresh, but no removal/re-wiring happens
  here.
