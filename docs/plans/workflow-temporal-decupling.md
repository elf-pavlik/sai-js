# Workflow decoupling via the Activity Registry — outcome / producer / test-verification

> **Status:** current state — `refactor-grants-workflows.md` is implemented and
> `test/` passes (⚠️ HTTP-DELETE of old grant resources commented out — see that
> plan, design decision 3). Sections 1–2 below document the **current** topology
> (services/handlers start workflows directly). Sections 3–7 specify the
> **target** topology: producers (admin authorization agents) write **activities**
> to the org's Activity Registry (outbox); the main agent's webhook channel
> delivers them and starts the workflows. The plan is organized around three
> questions per workflow: **intended outcome** (observable end-state), **producer
> method** (which service method changes the registry and writes the activity),
> and **test verification** (how `test/` listens for the outcome and asserts it).
> Two design pillars: (a) activities are created by **PUT** exactly like grants
> and data authorizations (`iriForContained` + `If-None-Match: *`), and (b) the
> registration `hasDataGrant` update becomes a **single PATCH** (remove old + set
> new), so each grant regeneration emits **exactly one `Update` notification** on
> the agent registration — the test signal.

---

## 1. Current state — direct workflow start/execute locations

All workflows are defined in `packages/components/src/temporal/workflows/` and
started via the custom `Temporal` client wrapper (`packages/components/src/temporal/client.ts`).

| # | Started by | Method | Workflow | Task queue | Context |
|---|---|---|---|---|---|
| 1 | `ReciprocalWebhookHandler` (`Update`) | `start` (fire-and-forget) | `updateDelegatedGrants` | `create-grants` | Peer registry changed; regenerates grantees of authorizations where the peer is data owner |
| 2 | `services/ShareResource.ts` `shareResource` | `start` (fire-and-forget, per grantee) | `createGrantsForAuthorization` | `create-grants` | After sharing a data instance |
| 3 | `services/RoleRegistry.ts` `updateRole` | `execute` (awaits) | `processRoleMembershipChange` | `create-grants` | Role member set changed |
| 4 | `services/RoleRegistry.ts` `deleteRole` | `execute` (awaits) | `processRoleDeletion` | `create-grants` | Role deleted |
| 5 | `services/Authorization.ts` `recordAuthorization` | `execute` (awaits) | `createGrantsForAuthorization` | `create-grants` | Access authorization recorded (granted/denied) |
| 6 | `GrantIssuanceHandler` | `execute` (awaits) | `storeGrant` | `create-grants` | Data-owner side: delegated grant issued |
| 7 | `InvitationHandler` | `start` (`startDelay: '10s'`) | `establishReciprocal` | `reciprocal-registration` | Social agent invitation accepted |

## 2. Referenced workflow definitions

All grant workflows live in `packages/components/src/temporal/workflows/grants.ts`:

| Exported workflow | Purpose |
|---|---|
| `createGrantsForAuthorization` | Entry: resolves grantee (agent/role) via `getGrantees`, spawns `createGrantsForAgent` per resolved agent |
| `createGrantsForAgent` | **Core, self-contained**: fetches all authorizations of the agent, generates all grants, `checkEquivalence` (dummy → reuse nothing), stores new grants + ACRs, requests delegations, updates the registration |
| `processRoleMembershipChange` | Regenerates affected peers (role as grantee) ∪ grantees of authorizations using the role as dataOwner (`findRoleUsage`) |
| `processRoleDeletion` | Scans usage **before** deletion, `deleteAuthorizations`, regenerates former members ∪ type-routed grantees |
| `updateDelegatedGrants` | `findAffectedGrantees` → `createGrantsForAuthorization` per grantee |
| `storeGrant` | Stores delegated grant data + ACRs (data-owner side) |

`establishReciprocal` lives in `workflows/reciprocal.ts`; `sendPushNotifications`
in `workflows/forward-to-push.ts`.

---

## 3. Target topology — the Activity Registry as the outbox

**In one sentence:** instead of executing the workflow from a handler/service,
**the producer adds an activity resource to the Activity Registry with the exact
payload needed to start the workflow**; the main agent's webhook channel on the
Activity Registry delivers it, and the **receiver starts/executes the workflow
based on the payload in the activity**. Two decouplings: *temporal* (the producer
never waits — the workflow runs later, durably) and *execution* (the producer
doesn't know the consumer — the subscriber owns starting and executing the
workflow). The payload is the ready-made workflow input the services already
build today, so the workflow layer is unchanged.

### 3.1 Activity creation — PUT, exactly like grants and authorizations

Producers do **not** POST to a special endpoint. Creating an activity is a plain
registry write that mirrors how data grants and data authorizations are created
today:

1. **Generate the IRI** — `ActivityRegistry.iriForContained(activityRegistry, factory)` (new crud module in `packages/data-model`, mirroring `grant-registry.ts` / `authorization-registry.ts` → `container.iriForContained`).
2. **Build the resource** — RDF/JSON-LD:
   ```jsonld
   {
     "id": "<registry>/activity/<uuid>",
     "type": ["interop:Activity"],
     "activityType": "authorizationRecorded",   // routes to the workflow
     "target": "<IRI of the changed record or container>",
     "payload": { "webId": { "id": "...", "type": ["interop:SocialAgent"] }, "authorizationGrantee": { "id": "...", "type": ["interop:Application"] } },
     "status": "pending",
     "createdAt": "<ISO 8601>"
   }
   ```
3. **PUT it** — `putJsonLd(activityIri, fetch, withContext(dataModelContext, activity), { 'If-None-Match': '*' })` with `Content-Type: application/ld+json` — the same call `storeDataGrant` (activities/grants.ts) and data-authorization storage (authorization-agent/src/authorization.ts) use.

The ACR on the Activity Registry container grants the org's **admin agents
Write** and the **main agent Read** (seeded at registry-set bootstrap, see §6.11).
The activity `Add` notification (container subscription) is what wakes the main
agent.

### 3.2 Registry placement

The Activity Registry is a registry in the registry set:
`interop:hasActivityRegistry <.../activity/>` added to the `RegistrySet`
alongside `hasAgentRegistry` / `hasAuthorizationRegistry` / `hasGrantRegistry` /
`hasRoleRegistry` / `hasDataRegistry` (see `environments/data/registry.trig`).
It is an LDP container whose members are activity resources.

### 3.3 Subscription + single handler

- The main agent subscribes once at bootstrap (`SubscriptionClient`,
  `WebhookChannel2023`) to the org's **Activity Registry container** only.
- One webhook handler maps the `Add`ed activity's `activityType` → workflow and
  starts it with the activity's `payload`. No per-change-type routes.
- `GrantIssuanceHandler` (`storeGrant`) is **exempt** — it always runs on the
  main org agent and keeps its direct call (§4.6).

### 3.4 Notification shape (CSS Solid Notifications v0.1, `WebhookChannel2023`)

```json
{
  "@context": ["https://www.w3.org/ns/activitystreams", "https://www.w3.org/ns/solid/notification/v1"],
  "id": "urn:...",
  "type": "Add | Remove | Update | Delete | Create",
  "object": "<IRI of the changed record>",
  "target": "<topic>",
  "published": "..."
}
```

- Container subscription (Activity Registry): `Add` (activity created,
  `object` = activity IRI), `Remove`, `Update` (container itself).
- Resource subscription (agent registrations — the test signal, §4.0): `Create` /
  `Update` / `Delete` for that registration resource.

### 3.5 Dev + test seeding of webhook subscriptions (pre-seeded channels)

**Both environments share the canonical seed files** in `environments/data/`; the
dev environment maps them to docker hostnames, the test environment uses them
as-is:

| File | Store | test (dagger) | dev (docker) |
|---|---|---|---|
| `registry.trig` | oxigraph quadstore | `test/setup.ts` `beforeEach` → `seedQuadstore('http://sparql/store', dataset)` | `interop seed-env --env dev` (`packages/repl/cmd.ts`) → `http://localhost:7878/store` |
| `kv.json` | Postgres `key_value` | `beforeEach` → `pg.seedKeyValue(kv)` | `seed-env` → `pg.seedKeyValue(kv)` |
| `test-client/` | S3 (garage) | S3mini `putAnyObject` | garage |

Canonical files use `https://` URLs (`https://auth/`, `https://registry/`,
`https://id/`, …). `environments/dev/map.json` (`agents` + `prefixes`) maps
them to docker hostnames; `generateRegistry` rewrites graph-header lines with
`prefixes` only and content lines with the full map — including URL-encoded
variants, so kv index keys like `accounts/index/…/sendTo/https%3A%2F%2Fauth%2F…`
map too. The test environment needs no mapping.

**Existing precedent — the reciprocal webhook is already pre-seeded** in
`environments/data/kv.json`, and `test/reciprocal-webhook.test.ts` POSTs
`{type:'Update'}` **directly to the pre-seeded sendTo**
(`https://auth/.sai/reciprocal-webhook/26bf5f67-…`), simulating CSS delivery —
no CSS-side channel state needed. The seed contains:

- account data `accounts/data/<alice-accountId>` →
  `"**reciprocalWebhook**": { "<uuid>": { "webId": "https://id/alice", "peerId":
  "https://id/bob", "accountId": "<alice-accountId>", "sendTo":
  "https://auth/.sai/reciprocal-webhook/26bf5f67-…", "channel":
  "{\"id\":\"https://registry/.notifications/WebhookChannel2023/<uuid>\",\"type\":\"http://www.w3.org/ns/solid/notifications#WebhookChannel2023\",\"topic\":\"https://registry/bob/agent/jc5gt6/\",\"sendTo\":\"https://auth/.sai/reciprocal-webhook/26bf5f67-…\"}" } }`
- index keys: `accounts/index/reciprocalWebhook/<id>`, `/webId/<webId>`,
  `/peerId/<peerId>`, `/sendTo/<sendTo>` → `[<alice-accountId>]`

The `channel` JSON is exactly what `SubscriptionClient.subscribe(topic,
WebhookChannel2023, sendTo)` returns. The route
(`^/.sai/reciprocal-webhook/.*` → `ReciprocalWebhookHandler`) lives in
`packages/components/config/http/handler/default.json`, imported by
`sai:config/auth.json`, which both `environments/css/auth.json` (dev) and
`environments/css/https/auth.json` (test/dagger) import — so both stacks get the
handler from the same config.

**Pre-seeding the Activity Registry webhook — the same pattern.** Phase 1 adds
the mirror-image pre-seed in `environments/data/kv.json`, so tests drive the
decoupled flow without any runtime subscription step:

1. **New `ActivityWebhookStore`** — mirror of `ReciprocalWebhookStore`, storage
   type `activityWebhook`, fields `accountId`, `webId`, `topic`, `sendTo`,
   `channel` (no `peerId`: the subscription targets the agent's own container).
2. **kv.json pre-seed** — one entry per main agent that runs producer services
   in tests (Phase 1: **alice** and **bob**): `"**activityWebhook**": {
   "<uuid>": { accountId, webId: "https://id/<name>", topic:
   "https://registry/<name>/activity/", sendTo:
   "https://auth/.sai/activity-webhook/<fixed-uuid>", channel: "{ id:
   'https://registry/.notifications/WebhookChannel2023/<uuid>', type:
   '…WebhookChannel2023', topic: 'https://registry/<name>/activity/', sendTo:
   'https://auth/.sai/activity-webhook/<fixed-uuid>' }" } }`; plus the index keys
   `accounts/index/activityWebhook/<id>`, `/webId/<webId>`, `/sendTo/<sendTo>`,
   `/topic/<topic>` → `[accountId]`.
3. **Route** in `packages/components/config/http/handler/default.json`:
   `OperationRouterHandler` with `allowedPathNames: ["^/.sai/activity-webhook/.*"]`
   → `ActivityWebhookHandler` (with `activityWebhookStore`) — shared by dev and
   test.
4. **No `registry.trig` change needed for tests** — the Activity Registry
   containers are already seeded (Phase 0); activity resources are PUT at test
   runtime.

Both environments get the entries for free: **test** uses the canonical URLs
as-is and `beforeEach` re-seeds kv.json (every test sees the channel); **dev**
maps them via `map.json` — the `https://auth/` prefix covers the sendTo
(`https://auth.docker/.sai/activity-webhook/…`), the `https://registry/` prefix
covers the topic and channel id (`https://reg.docker/…`). No `map.json` change
needed.

**Test flow with the pre-seeded channel (Phase 1):** (1) test PUTs the activity
resource to `https://registry/<name>/activity/<uuid>` with the main agent's
session (§3.1); (2) test POSTs `{type:'Add', object: <activity IRI>, target:
<activity container>}` to the pre-seeded sendTo — simulating CSS delivery,
exactly like `reciprocal-webhook.test.ts`; (3) `ActivityWebhookHandler` looks up
the store by sendTo, fetches the activity with the `webId` session, maps
`activityType` → workflow and starts it; (4) test awaits the registration
`Update` (§5) and asserts.

**Caveats / decisions:**

- **Pre-seed scope (decided).** The Phase 1 pre-seed covers only the app store
  (`ActivityWebhookStore`) and is **test-only** — tests POST to the handler
  directly and never touch CSS's own subscription state. CSS-side state for
  **dev** and the create-if-missing bootstrap for **real deployments** are
  separate phases (§7: Phase 2 and Phase 3).
- **CSS-side channel state is separate.** CSS v8 stores its own subscription
  state in the same kv store (`KeyValueChannelStorage`, keys
  `encodeURIComponent(channel.id)` + `encodeURIComponent(channel.topic)`). Tests
  don't need it (direct POST); Phase 2 pre-seeds it for dev; Phase 3 creates it
  at runtime for real deployments.
- **Per-account, not per-peer** — the Activity Registry subscription targets the
  agent's own container, so the store description and index differ from
  `reciprocalWebhook` (`topic` replaces `peerId`).
- **Tests exercise the handler, not CSS delivery** — the direct-POST pattern
  (inherited from `reciprocal-webhook.test.ts`) never exercises the real
  subscription → emitter → sendTo path; that stays a dev-only/manual concern
  until the durable-delivery work (§6.9).

---

## 4. Per-workflow: intended outcome / producer activity / test verification

### 4.0 The registration `Update` as the outcome signal (single-PATCH)

Every grant-generation workflow ends in `createGrantsForAgent`, which updates
**the grantee's registration in the grantor's agent registry**
(`AgentRegistry.findRegistration(registry, factory, grantee.id)`). Today that is
`clearDataGrantsOnRegistration` (N parallel PATCHes) + `setDataGrantsOnRegistration`
(M sequential PATCHes) → **N+M `Update` notifications** with observable
intermediate states (empty/partial link sets).

**Design decision — replace both with one atomic activity:**

```ts
export async function replaceDataGrantsOnRegistration(payload: {
  webId: SocialAgentId
  grantee: AgentId
  grants: GrantId[]           // the FULL new set (may be [])
}): Promise<void>
```

1. read the registration's current links: `getDataGrantIris(registration)`;
2. compute the diff: `removed = current − new`, `added = new − current`;
3. build one SPARQL update — `DELETE { <reg> interop:hasDataGrant ?removed . } INSERT { <reg> interop:hasDataGrant <added> . }` (same shape as `replaceStatement` in `data-model/src/crud/container.ts`);
4. one `PATCH` to the registration's description resource → **exactly one `Update`** on the registration's own notification channel.

`createGrantsForAgent` calls it once at the end; the deny case
(`authorizations.length === 0`) calls it with `[]` (one PATCH removing all
links). The no-op case (already empty → replace with `[]`) is **out of scope** —
we don't optimize for or test it.

**Why this matters:** the registration `Update` becomes the atomic, single
synchronization point per regeneration. When the test observes it, the
registration already reflects the final state — no intermediate states are
observable. This is the signal every grant workflow's test verification below
rides on.

### 4.1 `createGrantsForAuthorization` ← `Authorization.recordAuthorization` (RPC `AuthorizeApp`)

- **Intended outcome.** The grantee's full grant set is regenerated from *all*
  of its authorizations (not just the new one): source `DataGrant` resources +
  ACRs exist in the grantor's grant registry; delegated grants exist in data
  owners' grant registries (via `requestDelegation` → data owner's
  `storeGrant`); the grantee's registration `hasDataGrant` = exactly the current
  set — set by the **single PATCH** (§4.0) → **one `Update`**. Deny case
  (`granted: false`): zero authorizations → registration `hasDataGrant` = ∅,
  one `Update`.
- **Producer method.** `services/Authorization.ts` `recordAuthorization`:
  1. changes the **authorization registry** — `saiSession.recordAccessAuthorization(structure)` creates `DataAuthorization` resources (`iriForContained` + PUT, `If-None-Match: *`); 0 resources for deny;
  2. ensures the **agent registry** has the grantee's registration (`AgentRegistry.addApplicationRegistration` for unregistered application grantees);
  3. PUTs the activity (§3.1): `authorizationRecorded`, payload `{ webId: {id: saiSession.webId, type: [INTEROP.SocialAgent]}, authorizationGrantee: {id: authorization.grantee, type: [authorization.agentType]} }` — the ready-made `createGrantsForAuthorization` input (no lookups needed).
- **Test verification** (`test/authorization.test.ts`):
  1. **listen first**: open the notification stream on the target registration *before* the RPC — `grantorSession.findApplicationRegistration(clientId)` (application grantee) or `grantorSession.findSocialAgentRegistration(granteeId)` (social agent), both in the grantor's agent registry;
  2. call RPC `AuthorizeApp`;
  3. `receivesNotification(grantorSession.authFetch, registrationId, AS.Update)` — await the single `Update`;
  4. re-read the registration fresh → `getDataGrantIris` / `getDataGrants` → assert: grant case — expected grants present with `grantee` / `grantedBy` / `dataOwner` / `registeredShapeTree` / `scopeOfGrant` / `accessMode`; deny case — 0 links, `getGranted` falsy.

### 4.2 `createGrantsForAuthorization` ← `ShareResource.shareResource` (RPC `shareResource`)

- **Intended outcome.** Each affected grantee's grant set regenerated; the shared
  shape tree's grant now includes the newly shared instance (`SelectedFromRegistry`
  with the new `hasDataInstance`); one `Update` per grantee registration.
- **Producer method.** `services/ShareResource.ts` `shareResource`:
  1. changes the **authorization registry** — `saiSession.shareDataInstance(...)` creates new `DataAuthorization` resources (PUT);
  2. PUTs **one `authorizationRecorded` activity per deduped grantee** (share grantees are social agents): payload `{ webId: {id, type: [SocialAgent]}, authorizationGrantee: {id: grantee, type: [SocialAgent]} }`.
- **Test verification.** After RPC `shareResource`: listen for `Update` on each
  grantee's social-agent registration in alice's agent registry → re-read →
  assert the grant for the shared shape tree exists and `hasDataInstance`
  includes the shared instance.

### 4.3 `processRoleMembershipChange` ← `RoleRegistry.updateRole` (RPC `UpdateRole`)

- **Intended outcome.** Role used as **grantee** → added members' registrations
  gain grants (`Update`), removed members' lose them (`Update`). Role used as
  **dataOwner** (e.g. `AllFromRole`) → the *grantees of those authorizations*
  are regenerated (`Update` on their registrations); members' own received
  grants never change. Both usages merged/deduped; each affected agent's
  registration patched exactly once.
- **Producer method.** `services/RoleRegistry.ts` `updateRole`:
  1. changes the **role registry** — `RoleRegistry.updateRole(...)` PATCHes the role resource;
  2. computes the symmetric difference `before.members △ after.members` (it read the role before updating) — no snapshot store needed;
  3. if non-empty, PUTs the activity: `roleMembershipChanged`, payload `{ webId: {id, type: [SocialAgent]}, roleId: {id, type: [Role]}, peers: affected.map(m => ({id: m, type: [SocialAgent]})) }`.
- **Test verification** (`test/roles.test.ts` `verifyAccessGrant`). After RPC
  `UpdateRole`: listen for `Update` on the affected members' social-agent
  registrations in the grantor's agent registry → re-read → assert grant
  presence (`expectGrant: true`) or absence (`expectGrant: false`).

### 4.4 `processRoleDeletion` ← `RoleRegistry.deleteRole` (RPC `DeleteRole`)

- **Intended outcome.** The role's authorizations are HTTP-DELETEd from the
  **authorization registry** (`deleteAuthorizations`); grants revoked for former
  members (usedAsGrantee) and for grantees of the deleted role's
  dataOwner-authorizations → their registrations' `hasDataGrant` shrinks (one
  `Update` each).
- **Producer method.** `services/RoleRegistry.ts` `deleteRole`:
  1. reads the role first (captures `role.members`);
  2. changes the **role registry** — `RoleRegistry.deleteRole(...)` DELETEs the role resource;
  3. PUTs the activity: `roleDeleted`, payload `{ webId: {id, type: [SocialAgent]}, roleId: {id, type: [Role]}, peers: role.members.map(m => ({id: m, type: [SocialAgent]})) }` — `peers` = former members (unresolvable after deletion).
- **Test verification.** After RPC `DeleteRole`: listen for `Update` on former
  members' and dataOwner-authorizations grantees' registrations → re-read →
  `verifyAccessGrant(..., false)`.

### 4.5 `updateDelegatedGrants` ← reciprocal webhook (peer-driven, no activity)

- **Intended outcome.** Grantees of authorizations where the peer is data owner
  are regenerated — delegated grant links on their registrations appear/refresh
  (grantor side, §4.0 single PATCH).
- **Producer method.** None — the *peer* changed its registry; the reciprocal
  channel delivers `Update` to `ReciprocalWebhookHandler`, which starts the
  workflow (current §1 row 1, unchanged).
- **Test verification.** Existing `test/reciprocal-webhook.test.ts`: POST
  `{type: 'Update'}` to the reciprocal webhook endpoint →
  `receivesNotification(session.authFetch, applicationRegistrationId, AS.Update)`.

### 4.6 `storeGrant` ← `GrantIssuanceHandler` (exempt, no activity)

- **Intended outcome.** The delegated `DataGrant` resource + ACR exist in the
  data owner's grant registry. The grantee-side registration link happens on the
  **grantor** side inside `createGrantsForAgent` (via the single-PATCH replace,
  using the delegated grant ids returned by `requestDelegation`).
- **Producer method.** The delegation POST to the data owner's
  `delegation-issuance-endpoint`; the handler stores the grant (`iriForContained`
  + PUT). **No activity needed** — it always runs on the main org agent.
- **Test verification.** `test/delegation-endpoint.test.ts` unchanged (grant
  issuance stays `.execute` on the main agent).

### 4.7 `establishReciprocal` ← invitation (later, non-grant)

| | |
|---|---|
| **Intended outcome** | Reciprocal social agent registration discovered/added/subscribed on the invitee's side |
| **Producer method** | `InvitationHandler` creates the social agent registration in the **agent registry** → activity `agentRegistrationAdded` `{ webId, peerId, registrationId }` (`accountId` resolved by the handler via the webId store) |
| **Test verification** | To be fleshed out; `test/invitation.test.ts` today asserts the registration + reciprocal link after the RPC |

### 4.8 Summary table — change → activity → workflow → outcome signal

| RPC / trigger | Service method (registry change) | Activity (payload = workflow input) | Workflow | Outcome signal (test) |
|---|---|---|---|---|
| `AuthorizeApp` | `recordAuthorization` (authorization registry) | `authorizationRecorded` `{webId, authorizationGrantee}` | `createGrantsForAuthorization` | `Update` on grantee's registration → grant set / empty |
| `shareResource` | `shareResource` (authorization registry) | `authorizationRecorded` per deduped grantee | `createGrantsForAuthorization` | `Update` on each grantee's registration → grant with shared instance |
| `UpdateRole` | `updateRole` (role registry) | `roleMembershipChanged` `{webId, roleId, peers}` | `processRoleMembershipChange` | `Update` on affected members' registrations → grant present/absent |
| `DeleteRole` | `deleteRole` (role registry) | `roleDeleted` `{webId, roleId, peers}` | `processRoleDeletion` | `Update` on former members'/grantees' registrations → grants absent |
| reciprocal webhook | (peer's registry, via channel) | — (unchanged) | `updateDelegatedGrants` | `Update` on application registration (existing test) |
| delegation POST | `GrantIssuanceHandler` (grant registry) | — (exempt) | `storeGrant` | `delegation-endpoint.test.ts` unchanged |
| invitation | `InvitationHandler` (agent registry) | `agentRegistrationAdded` | `establishReciprocal` | later |

---

## 5. Test synchronization

**Await the first `Update` on the target registration — there is no reason to
count.** The single PATCH (§4.0) is atomic: the notification is emitted after
the patch commits, so when it arrives the registration already reflects the
final state. Counting to "exactly one" is impractical (a notification stream is
long-lived and never closes) and unnecessary: per-target serialization (§6.4/6.11)
guarantees one logical change → one `Update`. Other writers to the same
registration (access-need-group set, reciprocal link) emit their own `Update`s;
tests await the next `Update` *after* their trigger and notifications arrive in
order.

Pattern (per workflow, §4):

1. **Listen first** — open the notification stream on the target registration
   (`receivesNotification` discards the initial snapshot) *before* triggering.
   The outbox path (activity PUT → webhook → workflow) adds latency, so this is
   more important than today's direct topology.
2. **Trigger** the RPC (or POST the webhook / activity).
3. **Await** `receivesNotification(authFetch, registrationId, AS.Update)` — the
   registration's channel is discovered via HEAD `Link` header (existing helper,
   `test/util.ts`).
4. **Re-read and assert** — fetch the registration fresh →
   `getDataGrantIris` / `getDataGrants` → assert the exact grant set and fields.
   This is topology-agnostic: it also works with the current direct `.execute`
   topology (the `Update` arrives after the RPC returns).

Poll fallback: `waitFor(predicate, { timeout, interval })` in `test/util.ts`
(the plan's earlier proposal, §12 of the previous revision) stays for assertions
that don't ride on a notification (e.g. `findRole` lookups after `DeleteRole`).
Tests that don't assert workflow outcomes need no change (`delegation-endpoint`,
`access-request`, `agents`, discovery, policy-engine).

---

## 6. Design considerations

1. **The producer writes the typed change; the handler stays dumb.** Producers
   PUT an activity describing each change; the single handler maps
   `activityType` → workflow and passes the payload through. Payloads are
   ready-made workflow inputs the services already build today:
   `authorizationRecorded` → `{webId, authorizationGrantee}`,
   `roleMembershipChanged` → `{webId, roleId, peers}`,
   `roleDeleted` → `{webId, roleId, peers}` (former members),
   `agentRegistrationAdded` → `{webId, peerId, registrationId}`.
2. **Members of a deleted role come from the producer payload.** `deleteRole`
   reads the role **before** deleting it and includes `peers` (former members);
   `processRoleDeletion` keeps its signature `{webId, roleId, peers}` and runs as
   today (`findRoleUsage` → `deleteAuthorizations` → regenerate). No archive, no
   snapshot, no read-after-delete.
3. **No self-trigger loop.** The main agent subscribes only to the Activity
   Registry and its workflows never PUT activities — only admin agents do. Its
   own writes (grants, registration links, authorizations deleted by
   `processRoleDeletion`) never produce a notification it reacts to.
4. **Batching / dedup + per-target serialization.** `recordAuthorization` and
   `shareResource` record several authorizations in one operation, but the
   producer dedupes grantees and writes **one activity per grantee** — one
   notification, one workflow per grantee (matching today). The reciprocal path
   funnels into the same full regeneration, so concurrent activities for the
   same grantee from different operations still race: **serialize
   `createGrantsForAgent` per `(webId, grantee)`** (per-target consumer
   workflow, §6.11). The single-PATCH replace makes each run atomic, but two
   interleaved runs can still lose a link (each computes its diff from its own
   read) — serialization makes the *sequence* correct.
5. **Subscriptions established once at main-agent bootstrap** — a single
   subscription on the Activity Registry container (from the registry set), not
   on the individual registries. Channel stored keyed by `(accountId, container)`
   (same pattern as `reciprocalWebhook` + `ReciprocalWebhookStore`).
6. **Handler routing** — one webhook subscription / one handler on the Activity
   Registry container; `activityType` of the `Add`ed activity routes to the
   workflow; the handler reads the activity resource and starts the workflow
   with its payload.
7. **`establishReciprocal` — rely on Temporal retry policy, drop the
   startDelay.** The 10s delay was a hack for the race where the peer creates its
   reciprocal registration only after responding to the invitation. Configure
   the retry policy explicitly (e.g. `initialInterval: 5s`,
   `backoffCoefficient: 2`, `maximumInterval: 60s`, bounded `maximumAttempts`)
   rather than the raw default; permanent failure is recoverable via the
   reconciliation sweep (§6.11).
8. **Authorization revocation.** An admin revoking an authorization PUTs an
   `authorizationRevoked` activity → handler → regenerate the affected grantee
   (mirror of `createGrantsForAuthorization` for deletions). No
   authorization-registry `Remove` subscription needed, so the self-trigger
   caveat disappears: `processRoleDeletion`'s `deleteAuthorizations` writes no
   activity → no loop.
9. **Durable webhook delivery.** Replace CSS's default `WebhookEmitter` (direct
   POST, no durable retry) with a custom emitter that starts a Temporal workflow
   (e.g. `deliverWebhook({sendTo, body})` on the `forward-to-push` worker) whose
   activity POSTs the notification with a retry policy. Ordering: if ordering
   matters, serialize delivery per channel; otherwise the reconciliation sweep
   and idempotent full regeneration absorb out-of-order delivery.
10. **Out of scope.** Admin edits to the grant registry (no workflow today);
    data registries (only matter for reciprocal notifications — unchanged);
    the empty-replace no-op case (§4.0).
11. **Activity registry / outbox (core mechanism).**
    - **Append: the producers (admin agents), not the handlers.** Each admin
      authorization agent, after changing a registry, **PUTs an activity** to the
      org's Activity Registry — a plain registry write (`iriForContained` + PUT,
      §3.1; the ACR grants admin agents Write). One activity type per change:
      `authorizationRecorded`, `authorizationRevoked`, `roleMembershipChanged`,
      `roleDeleted` (with `peers`), `agentRegistrationAdded`. The main agent's
      workflows never PUT activities → no loop (3).
    - **Consume: the main agent.** The single subscription + handler (5, 6) maps
      each activity `Add` to its workflow. For per-agent regeneration, one
      **consumer workflow per target** (deterministic `workflowId` per
      `(webId, target)`) drains entries sequentially and **coalesces** bursts of
      `authorizationRecorded`/`authorizationRevoked` activities for the same
      grantee into a single `createGrantsForAgent` run (full regeneration is
      idempotent).
    - **Location:** the Activity Registry is a registry in the registry set
      (`interop:hasActivityRegistry <.../activity/>` in
      `environments/data/registry.trig`), an LDP container whose members are
      activity resources (`activityType`, `target`, `payload`, `status`,
      `createdAt`). Seeded at bootstrap with the container + ACR (main agent
      Control; admin agents Write; main agent Read). The consumer marks entries
      done (PATCH status) or removes them after processing; the reconciliation
      sweep reprocesses pending entries.
    - **Caveat (non-atomic write):** the activity PUT is a separate HTTP request
      from the registry change — if the admin agent crashes between the two, the
      follow-up is lost. Mitigations: write the activity first, then the change
      (with retry), or accept the gap and rely on the reconciliation sweep.
    - **Consumer wake-up (hybrid):** per-target consumer workflows woken by
      Temporal **signals** (low latency; missed notification needs the sweep as
      backstop) or by **polling/timers** (single source of truth; latency bounded
      by the poll interval). Recommendation: signal + periodic reconciliation
      sweep as backstop.
12. **Test synchronization after decoupling (`.execute` → `.start`).** Replaced
    by §5: await the registration `Update` via `receivesNotification`, then
    re-read and assert. `roles.test.ts` `verifyAccessGrant` (7 call sites) and
    `authorization.test.ts` (denied → `getGranted` falsy) switch from
    assert-after-RPC to listen-await-assert. Outcome-polling (`waitFor`) remains
    the topology-agnostic fallback; a more precise alternative — poll the
    activity entry until status `done` — couples tests to outbox internals and
    is not used.

---

## 7. Phased implementation — green suite after every phase and every step

Every phase below ends with **`pnpm test` green** (integration, `turbo run test
--concurrency=1` → vitest) and **`pnpm typecheck` green**. The decoupling phase
is split **one workflow at a time**: each step migrates exactly one producer to
writing an activity and its tests to listen-await-assert (§5), leaving the rest
of the topology untouched, so the suite passes after every step. Workflows not
yet decoupled keep their current direct start (`.execute`/`.start`) — mixed
topology is fine during transition.

Test-coverage map (which tests exercise which workflows):

| Workflow | Tests that assert its outcome today |
|---|---|
| `createGrantsForAuthorization` (via `recordAuthorization`) | `authorization.test.ts` (denied → `getGranted` falsy); `roles.test.ts` AllFromRole block (`AuthorizeApp` setup + `verifyAccessGrant` after `AuthorizeApp` in "create authorization for role with existing members") |
| `createGrantsForAuthorization` (via `shareResource`) | none — new test added in step 1.4 |
| `processRoleMembershipChange` | `roles.test.ts` — `verifyAccessGrant` after `UpdateRole` (7 call sites total, split across steps 1.1/1.3) |
| `processRoleDeletion` | `roles.test.ts` — `verifyAccessGrant` after `DeleteRole` (3 sites) |
| `updateDelegatedGrants` | `reciprocal-webhook.test.ts` (already listens for `AS.Update`) |
| `storeGrant` | `delegation-endpoint.test.ts` (exempt, unchanged) |
| `establishReciprocal` | `invitation.test.ts` (asserts registration existence only) |

Synchronous (workflow-independent) assertions — role resource state
(`findRole`), invitation/registration existence, `GetAuthorizationData`,
`CreateRole`, agents — keep passing unchanged in every step, because the RPC
service still returns the registry write result before/after PUTting the
activity; only workflow outcomes move async.

### Phase 0 — Foundation (behavior-neutral; suite green, no test changes)

| Step | Change |
|---|---|
| 0.1 | **Single-PATCH registration update** (§4.0): add `replaceDataGrantsOnRegistration` (`diff → one SPARQL PATCH`) next to `addDataGrant`/`removeAllDataGrants` in `packages/data-model/src/crud/agent-registration.ts`; `createGrantsForAgent` calls it once (deny case with `[]`); drop `clear`/`setDataGrantsOnRegistration` calls **and remove those two activities** (only `createGrantsForAgent` used them) |
| 0.2 | **`ActivityRegistry` crud module** in `packages/data-model`: `ActivityData` type (`activityType`, `target`, `payload`, `status`, `createdAt`), `iriForContained`, `createContainer` (mirroring `grant-registry.ts`) |
| 0.3 | **Seed** the Activity Registry: `interop:hasActivityRegistry <.../activity/>` in `environments/data/registry.trig` + container ACR (admin agents Write, main agent Control/Read) — inert until a producer writes to it |
| 0.4 | **Test helpers** in `test/util.ts`: split `receivesNotification` into `openNotificationStream(authFetch, resourceId)` (open + discard initial snapshot) and `awaitNotification(stream, type)` (listen-first pattern, §5); add `waitFor(predicate, {timeout, interval})` poll fallback |

Rationale for 0.1 first: it changes the notification count (N+M → 1) before any
test depends on notification semantics; the final registration state is
identical, so the current assert-after-RPC tests (`.execute` still awaited) and
`reciprocal-webhook.test.ts` (returns on the first `Update`) all stay green.

### Phase 1 — Decouple one workflow at a time (suite green after every step)

Step 1.1 builds the **consumer infrastructure**: the **pre-seeded app-store
webhook channel** for the Activity Registry container (§3.5 — kv.json entries,
test-only) + the single `activityType` → workflow handler. Later steps only add
one `activityType` mapping and migrate the producer + its tests. Real
subscription creation (CSS-side channel + runtime bootstrap) is deferred to
Phases 2/3.

**Step 1.1 — `updateRole` → `roleMembershipChanged` → `processRoleMembershipChange`**

- **Producer:** `services/RoleRegistry.ts` `updateRole` — drop
  `.execute(processRoleMembershipChange)`; after `RoleRegistry.updateRole`,
  compute the symmetric difference and **PUT** `roleMembershipChanged`
  `{webId, roleId, peers}` (§3.1) when non-empty.
- **Consumer (new):** `ActivityWebhookStore` + `ActivityWebhookHandler` and the
  `^/.sai/activity-webhook/.*` route (§3.5); the channel is **pre-seeded** in
  `environments/data/kv.json` (alice + bob, test-only). Handler reads the
  `Add`ed activity, maps `roleMembershipChanged` → starts
  `processRoleMembershipChange` with the payload (`.start`).
- **Tests:** migrate the `UpdateRole`-triggered `verifyAccessGrant` sites in
  `roles.test.ts` to listen-await-assert: open the stream on the affected
  member's social-agent registration **in the grantor's agent registry**
  (`aliceSession.findSocialAgentRegistration(kimId)` / bob for dan) **before**
  the RPC, await `AS.Update`, re-read, assert grant presence/absence. The
  `AuthorizeApp` calls in the same file still run synchronously (not yet
  decoupled) — their setup role is unchanged.
- **Gate:** `pnpm test` + `pnpm typecheck` green.

**Step 1.2 — `deleteRole` → `roleDeleted` → `processRoleDeletion`**

- **Producer:** `services/RoleRegistry.ts` `deleteRole` — drop
  `.execute(processRoleDeletion)`; after deleting the role resource, **PUT**
  `roleDeleted` `{webId, roleId, peers}` with `peers` = former members (read
  before deletion).
- **Consumer:** add `roleDeleted` mapping to the handler.
- **Tests:** migrate the `DeleteRole`-triggered `verifyAccessGrant` sites
  (delete grantee role, delete dataOwner role) to listen-await-assert on the
  affected agents' registrations, then assert grants absent. The plain "delete
  role test" asserts `findRole` only — synchronous, unchanged.
- **Gate:** green.

**Step 1.3 — `recordAuthorization` → `authorizationRecorded` → `createGrantsForAuthorization`**

- **Producer:** `services/Authorization.ts` `recordAuthorization` — drop
  `.execute(createGrantsForAuthorization)`; after `recordAccessAuthorization`
  (and the application-registration ensure), **PUT** `authorizationRecorded`
  `{webId, authorizationGrantee}`.
- **Consumer:** add `authorizationRecorded` mapping.
- **Tests:** migrate `authorization.test.ts` — restructure the denied case to
  exercise the real revocation path: (a) grant first, await `Update` on bob's
  **application registration** for `clientId`, assert grants present; (b) deny,
  await `Update`, assert `getGranted` falsy / 0 links. Migrate the single
  `verifyAccessGrant`-after-`AuthorizeApp` site in `roles.test.ts`
  ("create authorization for role with existing members") the same way.
- **Gate:** green.

**Step 1.4 — `shareResource` → `authorizationRecorded` (per grantee) → `createGrantsForAuthorization`**

- **Producer:** `services/ShareResource.ts` `shareResource` — drop the
  per-grantee `.start`; **PUT one activity per deduped grantee** (§4.2).
- **Consumer:** no handler change (same `authorizationRecorded` type).
- **Tests:** add a new share test (none exists today): share a data instance,
  listen-await-assert `Update` on each grantee's social-agent registration,
  assert the grant for the shared shape tree includes the new
  `hasDataInstance`.
- **Gate:** green.

**Step 1.5 — `establishReciprocal` → `agentRegistrationAdded` (invitation, non-grant)**

- **Producer:** `InvitationHandler` — after `addSocialAgentRegistration`, **PUT**
  `agentRegistrationAdded` `{webId, peerId, registrationId}` (replace the
  `startDelay` hack with the explicit retry policy, §6.7).
- **Consumer:** add `agentRegistrationAdded` mapping (resolves `accountId` via
  the webId store).
- **Tests:** `invitation.test.ts` — add the reciprocal-link outcome assertion
  (reciprocal registration exists with the invitee), using `waitFor` since
  reciprocal discovery is async; existing assertions unchanged.
- **Gate:** green.

**Unchanged in this phase:** `updateDelegatedGrants` (reciprocal channel,
already webhook-driven — the model for this pattern) and `storeGrant` (exempt,
stays `.execute` on the main agent).

### Phase 2 — Pre-seed the CSS side for dev (real webhook delivery)

Phase 1's kv.json pre-seed covers only the app store, which is enough for tests
(they POST to the handler directly) but not for real delivery: CSS v8 reads its
own subscription state from the same kv store (`KeyValueChannelStorage`:
`encodeURIComponent(channel.id)` → channel, `encodeURIComponent(channel.topic)`
→ channel[]). Without those keys, a producer PUTting an activity in dev
produces no notification.

| Step | Change |
|---|---|
| 2.1 | Add the **CSS-side entries** to `environments/data/kv.json` (canonical → mapped to dev automatically): `https%3A%2F%2Fregistry%2F.notifications%2FWebhookChannel2023%2F<uuid>` → the channel object (`{id, type, topic, sendTo}` — the same object `SubscriptionClient.subscribe` returns) and `https%3A%2F%2Fregistry%2F<name>%2Factivity%2F` → `[channel]` (the per-topic list CSS reads when delivering). Same accounts (alice, bob) and same topic/sendTo as Phase 1, so dev and test share the deterministic sendTo |
| 2.2 | Verify **end-to-end in dev**: PUT an activity to the activity registry → CSS delivers the `Add` to the pre-seeded sendTo → handler starts the workflow → grant outcome observable. Confirm the emitter reads channel state from storage only (no `.notifications` resource needed in `registry.trig`) |

- Gate: `pnpm test` green (unchanged — tests still POST directly) + manual dev
  verification.
- Note: the reciprocal channels can get the same CSS-side pre-seed for dev
  parity, but that's only needed if dev exercises reciprocal delivery; not part
  of this phase's gate.

### Phase 3 — Check-and-create webhooks in real deployments (bootstrap/reconciliation)

Real deployments have no pre-seeded kv.json — accounts are created at runtime
via `bootstrapAccount`. The main agent must ensure its Activity Registry
subscription exists: created on account creation, healed if missing (crash
between account creation and subscription, manual kv edits, partial pre-seed).

| Step | Change |
|---|---|
| 3.1 | **On account creation**: subscribe the main agent to its own Activity Registry container — `SubscriptionClient.subscribe(hasActivityRegistry, WebhookChannel2023, sendTo)` + store the app entry (idempotent: skip if the store already has an entry for the topic). Lives in `AccountService.bootstrapAccount` (has the session + accountId) or a Temporal workflow started from it |
| 3.2 | **Reconciliation (healing)**: per account, check the app-store entry AND the CSS-side channel (`KeyValueChannelStorage`): app entry exists but CSS channel missing → re-subscribe with the same sendTo (create-if-missing); both missing → create fresh. Runs at worker startup (accounts discovered via the kv store) and/or periodically — the same sweep that reprocesses pending activities (§6.11 / Phase 4.2) |
| 3.3 | **Determinism note**: in real deployments sendTo is a fresh random uuid per creation (determinism matters only for tests — Phase 1 pre-seed — and optionally dev — Phase 2 pre-seed) |

- Gate: `pnpm test` green; optional new test: bootstrap a fresh account
  (`bootstrapAccount`) and assert the app-store entry + CSS channel exist.

### Phase 4 — Hardening (behavior-preserving; suite green after every step)

| Step | Change | Why tests stay green |
|---|---|---|
| 4.1 | **Per-target consumer workflows**: deterministic `workflowId` per `(webId, target)`; drain + coalesce bursts of `authorizationRecorded`/`authorizationRevoked` for the same grantee into one `createGrantsForAgent` run (§6.4/6.11) | Full regeneration is idempotent — same end-state; tests await the registration `Update`, not the number of workflows |
| 4.2 | **Reconciliation sweep**: reprocess stale/pending activity entries (§6.11) | Add a test: mark an activity pending, run the sweep, assert the outcome via the existing listen-await-assert pattern |
| 4.3 | **Durable webhook delivery**: custom emitter → `deliverWebhook` Temporal workflow with retry (§6.9) | Tests POST to the handler endpoint directly (they simulate the emitter) — unchanged |
| 4.4 | **`authorizationRevoked`** activity support for admin revocation (§6.8) | Mirrors `authorizationRecorded` — same test pattern |
| 4.5 | (cross-cutting, from `refactor-grants-workflows.md`) **real `checkEquivalence`** — reuse equivalent existing grants | Dummy → real is outcome-neutral by construction (reused grants keep their ACRs); extend `roles.test.ts`/new test to assert reuse (no new grant IRI on re-run) |

### Phase 5 — Documentation pass (no code changes, suite green)

Every direct start in `packages/components/src` was removed **in its own
decoupling step** (Phase 1, steps 1.1–1.5 each "drop `.execute(...)`"), and the
`Temporal` client import becomes unused in each producer service in the same
step. The only direct starts remaining after Phase 1 are intentional:
`GrantIssuanceHandler` → `storeGrant` (exempt, §4.6) and
`ReciprocalWebhookHandler` → `updateDelegatedGrants` (peer-driven reciprocal
channel, §4.5). There is nothing dead to remove.

- Update this document's §1 table to the target topology (rows 2–5 and 7 now
  read "producer PUTs activity → handler starts workflow"); rows 1 and 6 stay.
- Delete the `.execute`-based test-synchronization notes; §5 (listen-await-
  assert) is the only synchronization story.
- Gate: `pnpm test` + `pnpm typecheck` green.
