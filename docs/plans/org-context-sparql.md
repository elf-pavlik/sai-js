# Org context + SPARQL read plane — combined plan

> **Status:** phase 1 ✅ done (dormant mirror writer). **Phase 2 ✅ done**
> (org-context peer-data reads via the session's internal SPARQL endpoint,
> `AdminSparqlHandler` HTTP-QUERY route — build + package suites + `/test`
> all green). **Phase 3 ✅ done** (context/session fix — P3-1–P3-4 +
> P3-2b; build + package suites + `/test` all green; committed).
> Supersedes and merges the earlier drafts
> `org-context-fix.md` / `sparql-reads.md` (deleted). Builds on Phase 2 of
> `org-admin-feature.md` — read its §2.4 (C1/C2), §2.7–2.8 first.
>
> Four phases, in this order. Phases 1–3 live in this document; **phase 4
> (per-owner datasets) lives in `isolated-datasets-and-sparql.md`**. Each
> phase ends all-green (`npm run build && npm run test`; `/test` runs are
> user-only — dagger setup), except **4b** which is a joint checkpoint
> (dagger harness changes are user-side).

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
| ✅ **2 — Reads → SPARQL** | org-context peer-data reads (reciprocal bodies + data grants, only when `webId != context`) move to SPARQL over the session's **internal** endpoint; gated `/sparql-admin` (HTTP `QUERY`), admin-facing; sessions/context untouched; everything else stays HTTP this phase | ✅ green — build + package suites + `/test` (user-run) pass |
| ✅ **3 — Context/session fix** | `Context.ts` returns user session + resolved registry set; owner identity from context; class-C fixes; writes-only risk | ✅ green — build + package suites + `/test` (user-run) pass; container-create probe as Dan confirmed (commit `50b44bf4`) |
| — **Phase 4** (extracted) | per-owner datasets + SPARQL endpoints (endpoint registry, store split, mirror activation, admin-endpoint discovery) — see `isolated-datasets-and-sparql.md` | joint with user (`/test` harness) |

Dependencies: 3 needs nothing from 1; 2 may consume global graphs directly
(mirrors optional until the store split); mirrors must be wired and
populated **before** the per-owner cutover (`isolated-datasets-and-sparql.md`
4b) — cross-graph queries die once stores split.

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

- **path-scoped route** `^/.sai/sparql-admin/.*`, carrying the target org
  base64url-encoded in the last path segment — the `AgentIdHandler`
  pattern (decode via `Buffer.from(segment, 'base64url').toString('utf8')`);
- **HTTP `QUERY` method only** (safe, read-only — draft
  `httpapi-safe-methods-wg`): the query travels in the request body as
  `application/sparql-query`; `application/sparql-update`, `POST`, and any
  mutating method are rejected with 405/415. CSS
  `OperationRouterHandler` matches raw method strings (verified against
  CSS 8.0.0-alpha.2), so `allowedMethods: ["QUERY"]` suffices;
- **gate** identical to `AgentIdHandler`'s admin branch: extract
  credentials, resolve the target org's session
  (`sessionManager.getSession(orgWebId)`), find the caller's
  social-agent registration held by that org, require non-empty
  `hasAdminGrant` marker (403 otherwise);
- **forward** the query to the internal endpoint variable
  (`urn:solid-server:default:variable:sparqlEndpoint`) as POST
  `application/sparql-query` (nginx→Oxigraph content-type routing,
  `environments/css/oxigraph.nginx.conf`), streaming bindings back as
  JSON (SELECT) / quads (CONSTRUCT, through the established
  quads→JSON-LD path);
- hygiene: execution timeout, forced LIMIT.
- **consumer: admin-facing only.** Server-side org-context reads use the
  internal endpoint directly (federation.md shortcut 1 — the shared
  store already holds the peer graphs); `/sparql-admin`'s in-tree
  consumers arrive with the phase-3 context fix and it becomes
  load-bearing for org-context reads at the 4b per-owner split.

⚠️ **Known limitation (accepted for now, removed in 4b):** the internal
endpoint is a global store — the gate restricts *who*, not *which graphs*.
Trusted-env only until per-owner stores exist.

### 2.3 View migration — scoped to what needs it now

**Scope decision:** phase 2 migrates only the reads that will end up
behind the admin SPARQL endpoint — the org-context RPC reads that
dereference peer-side data (reciprocal bodies + data grants), only when
`webId != context`. In this phase those reads go over the session's
internal endpoint (shared store); in phase 3/4b they switch to
`/sparql-admin` unchanged. Everything else stays exactly as today: personal
context reads, simple per-resource GETs, and iteration-based views are
re-evaluated *later* as opportunistic query optimizations — no behavioral
need to change them now.

Initial step (one mergeable change):

1. **Org-context peer-data reads** — `getSocialAgents` (both passes) and
   `buildSocialAgentProfile` in org context (`personal=false`): reciprocal
   registration bodies (label, `hasAccessNeedGroup`, admin marker — the
   marker itself is read locally off the org's own registration) and
   linked data grants (`dataOwner`, `hasStorage`, `accessMode`, …) come
   from typed SPARQL SELECTs against the **session's internal endpoint**
   (the shared store — federation.md shortcut 1; the org never calls its
   own `/sparql-admin`), queried
   **by resource IRI** (`GRAPH <iri> { … }`) — never by `saiSession.webId`;
2. **Pass-2 labels stay HTTP** — grants carry a `dataOwner` IRI but no
   label field, and registration `prefLabel`s only cover agents *we*
   registered; `webIdProfile` GETs (public, not access-controlled — no
   class-A risk) remain the label source, consistent with the scope
   guard below;
3. Everything else (`getApplications`, invitations, `getRoles`, admin
   authorizations, `getDataRegistries`, personal context) is **explicitly
   out of scope** this phase.

Mirror relationship: queries are parametrized by the *resource IRI*, so in
   the shared dev store they read the peers' live graphs; when mirror
   graphs activate (4b) the same queries resolve to mirror content with
   zero query changes. The dormant mirror call sites are **not** wired in
   phase 2 — mirror graph names are the peers' own IRIs, so writing them
   into the shared store would clobber the peers' live graphs.

Implementation shape:

- queries colocated with the org-read views
  (`services/queries/org.ts`), one function per view returning typed rows;
- **parameterize every query by registry-set/graph IRIs, never by
  `saiSession.webId`** — so phase 3 doesn't rewrite them;
- **endpoint reach (decided):** `packages/authorization-agent` is a local
  workspace package (root `node_modules` symlink), so its constructor
  gains a **required** `sparqlEndpoint` in `AuthorizationAgentDependencies`,
  stored on the instance; `SessionManager` (new ctor param wired from
  `urn:solid-server:default:variable:sparqlEndpoint` in `default.json`)
  passes it in `getSession`. Read fns use `saiSession.sparqlEndpoint` —
  no per-call params, no `ResolvedContext` churn; the same field becomes
  per-account in 4a. The only real caller is `SessionManager.getSession`;
  the package's own test suite is `describe.skip`-ed top-to-bottom (and
  already stale vs src), so a required param causes no test churn.
- **server-side org reads use the internal endpoint** — the org never
  calls its own `/sparql-admin` (federation.md shortcut 1: the shared
  store already holds the peers' graphs, so reciprocal bodies + grants
  are read cross-graph there); `/sparql-admin` is the admin-facing gate
  (§2.2) whose consumers arrive with the context fix;
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
plane. In this phase, **personal-context reads and iteration-based views
are also unchanged** (see §2.3 scope decision) — SPARQL is used only
where the admin endpoint is required.

### What deliberately does not change in this phase

Writes (REST/LDP through AA sessions — ACP enforcement + workflow
triggers), data-instance content fetches, public dereferences (client-id
documents, WebID profiles, shape-tree descriptions), personal-context
reads, and every iteration-based view not listed in §2.3 (applications,
invitations, roles, authorizations, data registries).

### Green conditions

Each step: full checkpoint green. Parity guaranteed by the
characterization tests of §2.1 plus existing suites.

### 2.4 Known issue — org-context `listDataInstances` on peers' registries

**Extracted → [`org-context-proxy.md`](org-context-proxy.md).** Summary:
org-context instance listing of peers' data registrations has no working
path — `Grant.getDataInstanceIterator` HTTP-dereferences the peer's data
registration/instances with the admin's credentials, which no peer ACR
matches. The peer-data *metadata* reads are SPARQL-migrated (phases 2–3);
instance *content* stays HTTP by the scope guard, mirrors cover registry
metadata only, and the per-owner split (4b) removes even the shared-store
fallback. The new plan owns the decision space (proxy / mirror-extended /
grantee-ACR) and the "does peer-instance listing enter org-context scope"
question. No test currently requires it.

---

## Phase 3 — context/session fix (writes-only impact)

### 3.0 Pre-implementation checklist (verified against current code)

Ordered, each step ends green (build + package suites; `/test` user-run).
`packages/components/src` unless noted. Site counts below are grep-verified.

1. ✅ **Baseline probe (user-run, do FIRST).** Current org-context suite
   green; CreateRole + AddAdmin in the org context as Dan exercised the
   **container-create** path under non-cascading member access (the §3.4
   guard) — passed (mutating seeded resources is known debt, out of
   scope, no test).

2. ✅ **P3-1 — `ResolvedContext` (`services/Context.ts`)** (implemented):
   - `resolveContext(userSession, context)` — no second session; org
     branch keeps `isAdminOf` gate + `getRegistrySet(context)`;
   - ApiHandler passes the resolved `ctx` struct to every service.

3. ✅ **P3-2 — registry-set migration** (implemented; all `services/*` take
   `ctx: ResolvedContext`, `ctx.registrySet.*` replaces `saiSession.registrySet.*`,
   `ctx.session.factory` replaces `saiSession.factory`):
   - AgentRegistry ×3 (addSocialAgent, createInvitation, acceptInvitation);
     RoleRegistry (getRoles via `RoleRegistry.roles(ctx.registrySet…)`
     module iterator, create/update/delete); Authorization (findUserDataRegistrations
     inline `DataRegistry.registrations`, activity/ACR/registry sites);
     Admin; DataRegistry; ShareResource.
   - **AA overrides**: `registrySet?: RegistrySetData` optional param on
     `findSocialAgentRegistration`, `findApplicationRegistration`,
     `findRole`, `findDataRegistration`; services use the data-model module
     iterators instead of the AA getters for the context registry.

3b. ✅ **P3-2b — org-context reads of the org's registrations → SPARQL**
   (implemented for the exercised surface): `queries/org.ts` gained
   `listContained` (container graph + `meta:` graph, both `ldp:contains`
   and `interop:hasSocialAgentRegistration` membership — seed stores
   membership in the meta graph) and `findSocialAgentRegistration`;
   registration frames now include `hasAdminGrant` (parity with the
   bundled `fromJsonLd`); `getSocialAgents`/`getDescriptions`/DataRegistry
   peer paths branch personal(HTTP) vs org(SPARQL);
   `findSocialAgentRegistrationInContext` used by Admin/DataRegistry.
   Roles/authorizations/grants remain HTTP in org context — verified
   ACP: un-`.acr`-ed containers inherit `#fullAdminAccess`(Dan),
   grant `.acr`s carry `#peerReadAccess`(Dan, Read).

4. ✅ **P3-3 — owner identity + ACR creator pairs** (implemented):
   `saiSession.webId` → `ctx.webId` (payload actors, grantedBy,       self-identity in descriptions, `invitationUrl`), ACR pairs
   `{ agent: ctx.webId, client: ctx.session.agentId }` (AgentRegistry ×2,
   Authorization). 

5. ✅ **P3-4 — class-C fixes** (implemented): DataRegistry own-vs-peer
   branches → `agentId === ctx.webId`; `AA.findResourceServerOwner`/
   `findResourceOwner`/`findShapeTreeForResource` and
   `AA.shareDataInstance` take optional `ownerWebId` (default `this.webId`);
   `Revocation` grantedBy skip → `ctx.webId`.

   *(Unexercised-org-context notes folded in: `authorizeApp`/
   `shareResource` still record through the AA's own registry set —
   commented as debt; `listDataInstances` instance content →
   `org-context-proxy.md`.)*

6. ✅ **P3-5 — verification (user-run).** `/test/org-context.test.ts`
   assertions unchanged; role creation now genuinely authenticates via
   **Dan's UAS** (`#fullAdminAccess` on un-`.acr`-ed containers) instead of
   the org's `fullOwnerAccess`; org-context reads resolve via the internal
   endpoints (§2 + P3-2b). Known debt (§3.4): PATCH/DELETE of seeded
   registration resources as Dan → 403 (own `.acr`, `fullOwnerAccess`
   only) — **no test exercises it**; fresh resources created under
   un-`.acr`-ed containers (roles, AdminAuthorizations, invitations)
   inherit `#fullAdminAccess` and work — verified by the baseline probe.
   Edge to watch: org-context `revokeGrants` deletes grant closures
   (seeded grants have own `.acr`) — unverified in tests; kept on the
   debt umbrella, not extended in scope.

7. **Excluded from phase 3 (verify, don't change):** temporal
   activities/webhooks keep building their own org sessions
   (server-side, trusted, legitimate); `getApplications`/invitations/
   access-request flows take `ctx` but stay personal-context-oriented in
   behavior; data-instance content reads unchanged (see
   `org-context-proxy.md`).

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
`resolveContext`. Server-side reads use the session's internal endpoint
(shared store holds all graphs; per-owner split in 4a/4b); org-context
reads switch to the org's `/sparql-admin` (discovered, carried in this
struct) at the 4b per-owner cutover — authenticated as the **admin**,
never as the org (the org uses its own internal endpoint for its own
registry, §2.3).

⚠️ **Prerequisite, load-bearing:** the session swap is only safe because
**all org-context reads are already SPARQL-backed** (P3-2b, §3.0). With
`ctx.session` = the user, HTTP reads of the org's own registries would
403 — per-resource `.acr`s grant Read to the *registered agent* or the
org, never to the admin (seed-verified: `z3k7wm/#peerReadAccess` matches
Bob's UAS, `n4m8qx/#peerReadAccess` matches Yoyo's); only un-`.acr`-ed
containers inherit `#fullAdminAccess`(Dan). `ResolvedContext` therefore
always carries the endpoint(s) reads run against; personal-context HTTP
reads stay untouched (the user's own ACRs match the user's session).

### 3.2 Service migration (§2.4 of org-admin-feature)

- **P3-2b first — org-context reads of the org's own registries → SPARQL
  (prerequisite of the session swap, full scope in §3.0/3b):**
  registration/role/authorization/grant listings via container-graph
  `ldp:contains` queries, per-resource reads and `hasDataRegistry`
  listings via `GRAPH <iri>` (UNION `meta:<iri>`), all parametrized by
  **`ctx.registrySet` graph IRIs** — never by `ctx.webId` — using
  `services/queries/org.ts`. Also the mirror-covered peer branches that
  are still HTTP: `getDataRegistries` peer branch, `findDataGrantIndex`,
  `listDataInstances` peer branch (reciprocal bodies + grants);
  `listDataInstances` **instance content** stays on the debt umbrella
  → `org-context-proxy.md`.
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
  mass-editing services (checklist step 1 / §3.4 guard).
- `/test/org-context.test.ts` assertions unchanged; role creation now
  genuinely authenticates via Dan's UAS vs `fullAdminAccess`; org-context
  reads (ListSocialAgents/ListRoles — the exercised surface) resolve via
  the internal SPARQL endpoints (§2 + P3-2b), verified by the suite as-is.
- Package vitest updated for new context-parameter shapes (components has
  no test harness; authorization-agent suite is `describe.skip`-ed;
  changes land in build + `/test`).
- Sanity checklist for the session swap: no org-context HTTP read remains
  after P3-2b (grep the service dirs for `factory.*(` calls on
  org-context paths and `saiSession.socialAgentRegistrations`-style
  iterations in org-context functions).

---

## Phase 4 — per-owner datasets & SPARQL (extracted)

Extracted into **`docs/plans/isolated-datasets-and-sparql.md`**: the
per-owner endpoint registry (**4a**, green everywhere) and the per-owner
store cutover (**4b**, joint checkpoint — mirror activation,
serialized syncs, external admin-endpoint discovery, environment work;
cross-owner isolation + mirror-freshness tests).

In short: phases 2–3 read the peers' live graphs from the shared store
(`federation.md` shortcut 1); 4b splits the store per owner, activates the
phase-1 mirrors (uncommenting the two call sites), and points
`/sparql-admin` + `ResolvedContext` at the org's own dataset. The
IRI-parametrized queries of phases 2–3 resolve to mirror graphs with **zero
query changes**.

---

## Decided

- Reads-over-SPARQL land **before** the context fix; writes stay REST/LDP.
- Mirror graphs are named after the source resource IRI (the IRI we would
  otherwise fetch); `meta:` graphs never replicated.
- Query style split: `CONSTRUCT` whole-graph fetches reusing the JSON-LD
  framing path (same POJOs as today), `SELECT` for cross-graph view joins.
- SPARQL is used exclusively for registry data; webid/client-id profiles,
  shape trees and data-instance content remain regular HTTP GET.
- `/sparql-admin`: path-scoped route `^/.sai/sparql-admin/.*` with the
  target org base64url-encoded in the last path segment (`AgentIdHandler`
  pattern); **HTTP `QUERY` method only** (`application/sparql-query`
  body, safe/read-only; updates and `POST` rejected); gate = non-empty
  `hasAdminGrant` on the caller's registration held by the target org;
  forwards to the internal endpoint variable.
- **Endpoint access:** `packages/authorization-agent` (local workspace
  package) gains an optional `sparqlEndpoint` on the AA
  (`AuthorizationAgentDependencies`); `SessionManager.getSession` sets it
  from `urn:solid-server:default:variable:sparqlEndpoint`.
- **Read transport split:** server-side org-context reads use the internal
  endpoint (federation.md shortcut 1 — the shared store holds peer
  graphs); `/sparql-admin` is the admin-facing gate, consumed by external
  admin clients now; org-context reads switch to it (authenticated as the
  admin, never the org) at the per-owner split —
  `isolated-datasets-and-sparql.md`.
- **Known issue (§2.4):** org-context `listDataInstances` on peers' data
  registries has no working path (data-instance content is out of scope
  for SPARQL/mirrors); no test requires it; tracked.
- **Phase-2 migration scope:** only org-context peer-data reads
  (`getSocialAgents` both passes + `buildSocialAgentProfile`,
  `webId != context`) move to SPARQL over the session's internal endpoint;
  all other reads (personal context, simple GETs, iteration views) stay
  unchanged until a later optimization pass. Pass-2 labels keep the HTTP
  `webIdProfile` source (grants/registrations carry no usable label for
  grant-owned agents).
- Mirror call sites stay dormant through phase 3; phases 2–3 queries read
  the peers' live graphs in the shared store and are IRI-parametrized so
  they resolve to mirror graphs unchanged at the per-owner cutover
  (`isolated-datasets-and-sparql.md`).
- ACP does not cascade: containers inherit root `memberAccessControl`;
  resources with own `.acr` don't. Seeded-resource mutation gap accepted
  as debt (future `syncAdminAcr` generalization).
- No new package-level test harness for `packages/components`; verification
  rides `/test` dagger checkpoints, reviewed/run/committed by the maintainer
  after each step.

## Open items

- Query timeouts / forced LIMIT values at the admin endpoint ($2.2
  hygiene; `isolated-datasets-and-sparql.md` 4b forwards `/sparql-admin`
  into the org's own store).
- Whether peer-instance content listing ever enters org-context scope
  (currently no; mirrors cover registry metadata only) — **extracted to
  `org-context-proxy.md`**, linked to the §2.4 known issue.

(rel term for endpoint discovery and mirror staleness/backfill moved to
`isolated-datasets-and-sparql.md` open items.)

## Phase-2 kickoff decisions (resolved)

- Endpoint supplied **on the AA constructor** in the local
  `packages/authorization-agent` package (**required** `sparqlEndpoint` in
  `AuthorizationAgentDependencies`), set by `SessionManager.getSession`;
  no signature churn in read fns. (Package tests: all `describe.skip`-ed,
  stale vs src — no vitest churn.)
- Server-side org reads use the **internal** endpoint; the org never
  calls its own `/sparql-admin` (it must pass its own gate as the admin).
- `/sparql-admin` speaks **HTTP `QUERY`** (safe — read-only) only.
- Mirrors stay **dormant until phase 4b**; the central internal endpoint
  already holds the original peer graphs (`federation.md` shortcut 1),
  which phase-2 reads target directly. IRI-parametrized queries resolve
  to mirror graphs unchanged at 4b.
