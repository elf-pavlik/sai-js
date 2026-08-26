# Org context + SPARQL read plane — combined plan

> **Status:** phase 1 ✅ done (dormant mirror writer — verified: build, package
> suites, `/test` user-run). Phase 2 (reads → SPARQL) next.
> Supersedes and merges the earlier drafts
> `org-context-fix.md` / `sparql-reads.md` (deleted). Builds on Phase 2 of
> `org-admin-feature.md` — read its §2.4 (C1/C2), §2.7–2.8 first.
>
> Four phases, in this order. Each phase ends all-green (`npm run build &&
> npm run test`; `/test` runs are user-only — dagger setup), except **4b**
> which is a joint checkpoint (dagger harness changes are user-side).

## Problem

Two entangled problems came out of implementing org-context operations:

1. **Wrong session model.** `packages/components/src/services/Context.ts`
   mints a second SAI session for the *org's* webId
   (`sessionManager.getSession(context, …)`). This contradicts
   org-admin-feature §2.4/C2: the admin must keep operating through their
   **own** AuthorizationAgent (their UAS client is what `fullAdminAccess`
   matches); writes currently ride the org's `fullOwnerAccess`, so the
   admin enforcement path is never exercised. Minting the org's
   `SelfIssuedSession` also only works because dev shares one CSS —
   impossible federated.
2. **Peer-side reads (class A).** Reciprocal social-agent registrations and
   the data grants linked from them live on the peer's server, whose ACRs
   grant `(peer, peerUAS)` only. Once the admin's real credentials are
   used, those HTTP dereferences 403.

Plus latent bugs that surface the moment the session model is fixed
(class C): several code paths compare against / assign `saiSession.webId`
where they mean the *context* webId and would silently take wrong branches
(`DataRegistry.getDataRegistries`/`listDataInstances` branch selection,
`AA.findResourceServerOwner`, `shareDataInstance` self-filter,
`Revocation` grantedBy filter).

### Resolution strategy (decided)

Move **all registry-set reads** to SPARQL against the owning endpoint
**before** fixing the session model. The current global SPARQL endpoint
already holds every agent's graphs, so reads stop dereferencing peers over
HTTP entirely and class A evaporates without touching credentials. The
context fix then shrinks to a writes-only change. Writes stay REST/HTTP
(LDP through the AA) — they are the enforcement-relevant path.

### ACR semantics constraint (corrected, load-bearing)

CSS ACP does **not** cascade: `acp:memberAccessControl` applies only to
resources **without their own `.acr`**. Consequences for the seed:

| Resource | Own `.acr`? | Dan (admin) can |
|---|---|---|
| root + sub-registry containers (`registry/yoyo/**`) | no | Read/Write/Create via inherited `#fullAdminAccess` ✅ |
| seeded registrations/grants/authorizations | yes (`fullOwnerAccess` + `peerReadAccess`(dan)) | Read only ❌ no mutation |

So after the context fix: creating resources (roles, activities,
AdminAuthorizations, invitations) works; **mutating/deleting pre-existing
seeded resources does not** (e.g. PATCH an existing registration via
`authorizeApp` in org context). No current test exercises this; recorded as
known debt — long-term fix: extend the `syncAdminAcr` derivation down to
per-resource `.acr` rewriting. Verified against the seed: yoyo's
sub-registries have no container-level `.acr`.

---

## Phase map

| # | Scope | Checkpoint |
|---|---|---|
| ✅ **1 — Mirror writer (dormant)** | replicate reciprocal registrations + linked grants into graphs named after the source resources; implemented, **not wired**, no new test harness | ✅ green — build + package suites + `/test` (user-run) pass; mirror runtime behavior still deferred: call sites commented out until 4b, unregister flow future |
| **2 — Reads → SPARQL** | all registry-set read operations query the SPARQL endpoint (internal, both contexts); sessions/context untouched; introduce gated `/sparql-admin`; characterization tests first | green, stepwise parity |
| **3 — Context/session fix** | `Context.ts` returns user session + resolved registry set; owner identity from context; class-C fixes; writes-only risk | green; one dagger verification of container-create path |
| **4a — Endpoint registry** | per-owner endpoint addresses in `AccountLoginStorage`, env-var fallback retained | green |
| **4b — Per-owner cutover** | one store per registry/storage; mirrors **must be active before cutover**; external admin-endpoint discovery | joint with user (`/test` harness) |

Dependencies: 3 needs nothing from 1; 2 may consume global graphs directly
(mirrors optional until 4b); mirrors must be wired and populated **before**
the 4b cutover (cross-graph queries die once stores split).

---

## Phase 1 — replicate reciprocal registration + linked grants (dormant)

### What gets mirrored

For each registration in the org's Agent Registry carrying a
`reciprocalRegistration` link:

- the reciprocal registration body (label/note, `hasAccessNeedGroup`);
- the data grants linked from it (`grantedBy`, `dataOwner`,
  `registeredShapeTree`, `hasDataRegistration`, `hasStorage`,
  `accessMode`(s), scope).

This covers everything class-A read sites dereference today:
`buildSocialAgentProfile`, `getSocialAgents` pass 2, `findDataGrantIndex`,
`AA.findGrantForResource`.

### Storage shape (decided)

Named graphs whose **name is the original resource's IRI** — the same IRI we
would otherwise HTTP-GET, used directly as the graph name:

- the mirror of `https://registry/bob/agent/x7n2qv/` lives in graph
  `<https://registry/bob/agent/x7n2qv/>`; each mirrored grant likewise in a
  graph named after its own IRI;
- `meta:` graphs are never replicated;
- idempotent replace: `DROP GRAPH <iri>; INSERT DATA { GRAPH <iri> { … } }` — implemented as: reciprocal graph always refreshed (its body mutates, its links are the drift signal); grant graphs already present in the mirror are skipped entirely (grants are immutable — “already mirrored” ≡ “still current”), so re-runs neither re-fetch from the peer nor re-write unchanged grants;
- written/deleted by server-side code using the **org's** session
  credentials (legitimate there; same as workflows);
- consequence worth noting: graph names are peer-owned IRIs living in the
  org-local store — unambiguous because that store only ever contains
  mirrors the org itself wrote;
- **single-writer invariant:** mirrors are written *only* by the server-side
  sync (webhook handler / invitation flow / unregister flow); admin-facing
  code treats them strictly read-only.

### The dormant function

New `packages/components/src/services/ReciprocalMirror.ts`:

```ts
export async function updateReciprocalMirror(
  saiSession: AuthorizationAgent,       // ORG session (server-side)
  registration: SocialAgentRegistrationData,
  sparqlEndpoint: string
): Promise<void>
export async function deleteReciprocalMirror(...)
```

Implemented, **wired but DISABLED** — the outbox pattern applies:
`ReciprocalWebhookHandler` only records the `delegatedGrantsUpdated`
activity; `ActivityWebhookHandler` is set up to start a
**`syncReciprocalMirror` workflow** in parallel with
`updateDelegatedGrants`, and `establishReciprocal` is set up to create the
initial mirror — **both call sites are commented out until phase 4b**,
because mirror graphs share their names with the LIVE peer graphs in the
single shared store (writing them would DROP/replace the peers' actual
resources; see `federation.md` shortcut 1a). Re-enabling = uncommenting
two blocks. The activity reads `CSS_SPARQL_ENDPOINT` from the worker env.
Both mirror ops run as Temporal activities with their own `proxyActivities`
policy block (the sync's startToClose budget covers N peer grant fetches;
5 attempts — failures are recovered by the phase-4.2 reconcile-sweep
mirror arm, see Open items). Unregister mirror deletion lands when that
flow exists — as a **Temporal workflow** with `deleteReciprocalMirror` as
one compensable step (durable + retried; compensation = re-run the sync).
The dormant `deleteReciprocalMirror` activity is already in
`temporal/activities/reciprocal.ts`, so once the unregister flow exists the
wiring is code-only.

---

## Phase 2 — all registry-set reads via SPARQL

The big mechanical phase. Sessions, context model, and ownership stay
exactly as today (impersonation included) — pure transport parity, so all
suites stay green by construction at every step.

### 2.1 Characterization tests first

Before migrating any view, pin its exact current output in `/test`
(user-run additions): labels, ordering-sensitive fields,
`accessRequested`/`admin` flags, counts. SPARQL rewrites fail subtly
(duplicate rows, missing optional bindings), not loudly.

### 2.2 Gated admin endpoint

New handler (`AdminSparqlHandler`), wired in
`packages/components/config/http/handler/default.json` next to the other
`/.sai/…` routers:

- **path-scoped route** carrying the target org, consistent with the other
  `/.sai/…` routers (exact pattern settled during implementation;
  `AgentIdHandler`'s `^/.sai/agents/.*` is the closest precedent);
- query-only — accept `application/sparql-query`, never forward updates;
- gate identical to `AgentIdHandler`'s admin branch: extract credentials,
  find the caller's social-agent registration held by the target org,
  require non-empty `hasAdminGrant` marker (403 otherwise);
- forward the query to the internal endpoint variable
  (`urn:solid-server:default:variable:sparqlEndpoint`), stream bindings
  back as JSON;
- hygiene: execution timeout, forced LIMIT.

⚠️ **Known limitation (accepted for now, removed in 4b):** the internal
endpoint is a global store — the gate restricts *who*, not *which graphs*.
Trusted-env only until per-owner stores exist.

### 2.3 View migration order (each its own mergeable step)

Reads move from SDK iteration to typed SPARQL SELECTs. In this phase
**both** personal and org contexts use the internal endpoint; the
personal/admin split becomes meaningful in phase 3.

1. **AgentRegistry views** — `getSocialAgents` (both passes),
   `buildSocialAgentProfile`. Peer data (reciprocal bodies, peer grants)
   queried directly from the global store's peer graphs for now; switched
   to mirror graphs when activated (deadline 4b).
2. **RoleRegistry + Admin views** — role listing, admin authorizations,
   last-admin guard count.
3. **Authorization/Grant views** — `getDescriptions` registry parts,
   grant listing behind `revokeGrants`, `findAgentsWithAccess`.
4. **DataRegistry metadata views** — registries/data-registrations
   listings. Data-instance **content** fetches stay as-is.

Implementation shape:

- queries colocated with services (e.g. `services/queries/agentRegistry.ts`),
  one function per view returning typed rows;
- **parameterize every query by registry-set/graph IRIs, never by
  `saiSession.webId`** — so phase 3 doesn't rewrite them;
- endpoint injected per call (internal now; split arrives in phase 3/4);
- temporal activities / webhook handlers keep direct internal-endpoint
  access (owner identity, trusted).

### Query style (decided)

Two shapes, mirroring how CSS `SparqlDataAccessor` works versus what views
need:

- **`CONSTRUCT { ?s ?p ?o } WHERE { GRAPH <iri> { ?s ?p ?o } }`** for
  single-resource reads — whole-graph fetch exactly like SparqlAccessor's
  `getData`. The resulting quads go through the established
  quads → JSON-LD → frame path (`data-model` conventions), producing the
  **same POJO types services consume today** (`SocialAgentRegistrationData`,
  `GrantData`, …). Read sites therefore swap transport without changing
  their downstream code;
- **`SELECT`** for cross-graph listing/aggregation views (agent-list pass 2
  joining registrations with mirrored grants, admin-authorization counts,
  grant listings) — joining in the query beats fetching N whole graphs.
  Typed rows mapped manually at the query-function boundary.

Scope guard (decided): SPARQL reads **only registry data** (plus the
admin-endpoint special case). WebID profiles, client-id documents,
shape-tree descriptions and data-instance content stay plain HTTP GET —
they are not access-controlled (webid/clientid) or belong to the data
plane.

### What deliberately does not change in this phase

Writes (REST/LDP through AA sessions — ACP enforcement + workflow
triggers), data-instance content fetches, public dereferences (client-id
documents, WebID profiles, shape-tree descriptions).

### Green conditions

Each step: full checkpoint green. Parity guaranteed by the
characterization tests of §2.1 plus existing suites.

---

## Phase 3 — context/session fix (writes-only impact)

### 3.1 `ResolvedContext`

```ts
export type ResolvedContext = {
  /** ALWAYS the signed-in user's own AuthorizationAgent */
  session: AuthorizationAgent
  /** target registries: own (personal) or org's (admin context) */
  registrySet: RegistrySetData
  /** owner identity for writes: context webId */
  webId: string
  /** the signed-in user's webId */
  userWebId: string
}
```

Personal: `{ session: userSession, registrySet: userSession.registrySet,
webId: userSession.webId }`. Org: gate on admin marker as today, then
`registrySet: await userSession.getRegistrySet(context)` — **no second
session built**; drop the `sessionManager` parameter from
`resolveContext`. Reads pick internal vs `/sparql-admin` endpoint from
this struct.

### 3.2 Service migration (§2.4 of org-admin-feature)

- `saiSession.registrySet.*` → `ctx.registrySet.*`
  (AgentRegistry ×3, RoleRegistry ×4, Authorization ×5, Admin ×6,
  DataRegistry ×1, ShareResource ×3);
- owner identity `saiSession.webId` → `ctx.webId` (`grantedBy`,
  `dataOwner`, activity payload actor, Revocation filter);
- ACR creator pairs `{ agent: saiSession.webId, client: saiSession.agentId }`
  → `{ agent: ctx.webId, client: ctx.session.agentId }` (org owns, admin's
  UAS authenticates — AgentRegistry ×2, RoleRegistry ×2, Authorization ×2);
- AA methods hardcoding `this.registrySet` (`findSocialAgentRegistration`,
  `findApplicationRegistration`, `findRole`, `findDataRegistration`,
  `socialAgentRegistrations`/`applicationRegistrations` getters): add
  optional `registrySet?: RegistrySetData` override defaulting to own.

### 3.3 Class-C fixes (same step as 3.2 or wrong branches fire)

- `DataRegistry` own-vs-peer branch checks → compare against **context
  webId**;
- `AA.findResourceServerOwner`: `ownerId = this.webId` → matched registry
  set's owner;
- `shareDataInstance` self-filter → context webId;
- `Revocation` grantedBy skip → context webId.

(With reads already on SPARQL, most of these become parameters to query
functions rather than runtime branches.)

### 3.4 Known debt accepted in this phase

Mutating/deleting **seeded** resources as Dan fails (own `.acr`, no
cascade — see constraint above). No test exercises it. Fix later by
deriving per-resource ACRs from the admin list (`syncAdminAcr`
generalization); tracked as follow-up, not in this plan's scope.

### Verification

- One early user-run dagger pass exercising CreateRole/AddAdmin as Dan —
  confirms container-create path under non-cascading member access before
  mass-editing services.
- `/test/org-context.test.ts` assertions unchanged; role creation now
  genuinely authenticates via Dan's UAS vs `fullAdminAccess`.
- Package vitest updated for new context-parameter shapes.

---

## Phase 4 — per-owner SPARQL endpoints

### 4a — Endpoint registry (green everywhere)

Per-owner endpoint addresses in `AccountLoginStorage` — the
`ReciprocalWebhookStore` pattern (`RECIPROCAL_WEBHOOK_STORAGE_TYPE`):

```
type 'sparqlEndpoint' = { accountId, webId: string, endpoint: string }
```

- provisioned at account/registry-set bootstrap (`services/Account.ts`);
- `SessionManager.getSession(webId)` resolves the record, hands each AA
  its own internal endpoint; **env-var fallback retained** so nothing else
  must change yet;
- migrate direct consumers (`SaiPermissionsEngine`,
  `SaiAuthorizationManager`, `GrantRevocationHandler`) to session-scoped /
  looked-up endpoints.

### 4b — Per-owner store cutover (joint checkpoint)

Prerequisite checklist before flipping environments:

- [ ] mirrors wired and backfilled for all existing reciprocals (until this
      cutover, phases 2–3 read peer graphs directly from the shared store —
      see `federation.md` shortcuts 1/1a); re-enabling = uncommenting the two
      disabled call sites (`ActivityWebhookHandler` `delegatedGrantsUpdated`
      fan-out + `establishReciprocal` initial-mirror step). The worker env
      var + `sparql` service binding are **already added** in
      `.dagger/src/index.ts`, so re-enabling is code-only. The mirror write deliberately lives ONLY at
      those workflow-orchestration sites — never inside the
      `reciprocalRegistration` discovery activity
      (cross-graph queries die once stores split);
- [ ] mirror syncs serialized per (webId, peerId): deterministic workflowId
      with start-or-absorb (grantee-consumer pattern) — random workflowIds
      today allow two syncs for the same reciprocal to race, and a stale-diff
      drop could remove a graph a concurrent newer sync just re-linked;
- [ ] `/sparql-admin` forwards into the **org's own store** — closes the
      global-graph caveat from §2.2;
- [ ] external discovery for admins, mirroring C2's mechanism:
      `AgentIdHandler` exposes the org's admin-endpoint IRI to admins
      (third `Link` header with new rel, e.g. `hasSparqlEndpoint`, or a
      field in the agent-id document body next to
      `hasDelegationIssuanceEndpoint` — term naming tbd); AA resolves +
      caches it like `getRegistrySet`; `ResolvedContext` carries it;

Environment work (user-side): per-store containers + nginx wiring in
`environments/css`, seed loading per owner, `setup.ts`/`kv.json` updates.
Then drop the global env var.

### Tests

- `/test` (user-run): cross-owner isolation — Dan querying Alice's
  endpoint → 403 by gate; Dan's queries never see Alice graphs even at his
  own endpoint; org-context flows green end-to-end against per-owner
  stores; mirror freshness e2e (peer update → webhook → `waitFor` → view
  reflects; unregister → mirror deleted).
- Package vitest: endpoint-record CRUD, bootstrap wiring.

---

## Decided

- Reads-over-SPARQL land **before** the context fix; writes stay REST/LDP.
- Mirror graphs are named after the source resource IRI (the IRI we would
  otherwise fetch); `meta:` graphs never replicated.
- Query style split: `CONSTRUCT` whole-graph fetches reusing the JSON-LD
  framing path (same POJOs as today), `SELECT` for cross-graph view joins.
- SPARQL is used exclusively for registry data; webid/client-id profiles,
  shape trees and data-instance content remain regular HTTP GET.
- `/sparql-admin`: path-scoped route, gate mirrors `AgentIdHandler`'s
  admin-marker check, query-only.
- ACP does not cascade: containers inherit root `memberAccessControl`;
  resources with own `.acr` don't. Seeded-resource mutation gap accepted
  as debt (future `syncAdminAcr` generalization).
- Endpoint-per-owner addresses in `AccountLoginStorage`; external admin
  discovery mirrors the `hasRegistrySet` mechanism.
- No new package-level test harness for `packages/components`; verification
  rides `/test` dagger checkpoints, reviewed/run/committed by the maintainer
  after each step.

## Open items

- rel term / doc field name for endpoint discovery (vocab addition).
- Mirror staleness policy (re-poll on webhook gap?) and initial backfill
  tooling for existing registrations — **a phase-4b prerequisite only**;
  phases 2–3 do not depend on mirrors being populated. Note: the
  `done` status of a `delegatedGrantsUpdated` activity reflects grant
  regeneration only — the parallel mirror-sync workflow retries
  independently. **Decided:** when `reconcileActivities` is scheduled
  (currently never scheduled — Phase 4.2), its `delegatedGrantsUpdated`
  branch also re-runs `syncReciprocalMirror` for the failed-mirror case,
  plus a drift-scan arm (reciprocal-linked registrations whose mirror graph
  is missing) as the durable backstop beyond activity retries.
- Query timeouts / forced LIMIT values at the admin endpoint.
- Whether peer-instance content listing ever enters org-context scope
  (currently no; mirrors cover registry metadata only).
