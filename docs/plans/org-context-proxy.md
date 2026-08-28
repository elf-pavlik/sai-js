# Org-context data-instance reads — peer-data proxy

> **Status: implemented and verified.** Direction decided (server-side
> proxy): the `/.sai/proxy-admin` endpoint, the shared admin gate, the
> admin-side clients (`fetchPeerDocument`, `peerInstanceIris`,
> `sparqlTransportFor`) and all three wired data-plane paths (counts,
> listing, `GetResource`) are implemented; the registry plane goes via
> `/.sai/sparql-admin` (last step). Verified end-to-end in `/test`
> (org-context proxy parity suite) + 262 package unit tests. Extracted from
> the `org-context-sparql.md` §2.4 known issue (org-context
> `listDataInstances` on peers' registries) + its linked open item
> ("whether peer-instance content listing ever enters org-context scope")
> — answered: yes, via the proxy. Upstream phases 1–3 are prerequisites,
> done.

## Problem

`DataRegistry.listDataInstances(ctx, agentId, registrationId, lang)` with
`agentId != ctx.webId` (the **peer branch**) lists the data instances
inside a *peer's* data registration that the context has grants for. It
iterates via `Grant.getDataInstanceIterator(dataGrant, factory)`, which
HTTP-dereferences the peer's server — with the session's credentials.
What is dereferenced depends on the grant's scope:

- `AllFromRegistry` — the peer's data registration document (`contains`)
  and each data instance document;
- `SelectedFromRegistry` — each data instance document named in
  `hasDataInstance` (the instance list itself is grant metadata, already
  SPARQL-resolvable; the *documents* still need fetching);
- `Inherited` — the parent grant (registry-side, mirrored), the parent
  instance's **content** (`frameDataInstance`, shape-tree framed — a full
  body read, not just labels), then the child instance documents.

> **Scope: org-admin reads only.** The org admin needs *read* access to
> peer-granted data; org-context *writes* into peer registries (the org as
> grantee holding `Write`, e.g. a shared inbox/project registration) are
> out of scope — no current RPC exercises them (no `createDataInstance`
> surface), and every direction below is reads-only.

In org context the session is the **signed-in admin** (phase-3 context
fix), and those HTTP requests carry the admin's UAS:

- the peer's data server authorizes by **data grants** (the permission
  engine, federation.md §1 — data registries/instances do not use ACRs);
  the admin holds no grants (they flow to the org) → **403**;
- the admin's own credentials don't help — grants flow to the **org**, not
  the individual admin;
- the data instances legitimately *accessible* to the org (the peer issued
  data grants to it) are not reachable through the admin's session.

So an org admin can see the **metadata** of peers' data registries (the
grant-derived registry list in `getDataRegistries`, SPARQL-migrated in
phases 2–3) but **cannot read any peer-registry instance data the org
holds grants for**. The affected read paths (all org-as-grantee, all HTTP
with the admin's UAS):

1. `listDataInstances` **peer branch** — instance listing. Two consumers:
   the `DataRegistryList` browse, and the `AuthorizeApp` delegation select
   (the admin picking `some` instances of a peer's registration to
   delegate when the peer is a data owner). Both are the same
   `listDataInstances` bottleneck.
2. `getDescriptions` → `findSocialAgentDataRegistrations`
   (`services/Authorization.ts`) — the per-registration instance **count**
   for `AllFromRegistry` grants was `factory.dataRegistration(
   hasDataRegistration).contains.length`, an HTTP read of the peer's data
   registration — but the `contains` fallback was **dead**: `hasDataInstance`
   defaults to `[]` (truthy), so the count was silently **0** in both
   contexts. Fixed (rollout step 2): `scopeOfGrant` is the discriminator,
   and the `contains` read goes through `dataRegistrationContains`
   (personal: direct factory; org: `/proxy-admin`). `SelectedFromRegistry`
   counts come from grant metadata and are fine.
3. `getResource` (`services/ShareResource.ts`, via
   `AA.findAgentsWithAccess`) — **in scope**: a full-body single-instance
   read (`factory.dataInstance` + children + the "who has access" listing)
   when the resource lives in a peer registration. Distinct from
   `listDataInstances`'s labels-only listing; the share flow that calls it
   is still session-own debt, but the read itself lands here (same 403 the
   moment it is org-context-exercised).

Boundary: the **own branch** of `listDataInstances` (`agentId ===
ctx.webId`) HTTP-reads the *org's own* data registration + instance docs
as the admin — same 403 class on the org's own server (phase-3 §P3-5) —
but it is *not* a peer-grantee case and is a separate fix if exercised.

## Access model — what the admin's AA can and cannot read

The admin's org-context session has three different reachabilities:

- **The org's own registries (registry plane) — readable.** Registrations,
  roles, authorizations, grants are read via the org's store
  (`queries/org.ts`, SPARQL-backed in phases 2–3).
- **Peers' registries — registry metadata (the reciprocal registration +
  linked data grants): NOT readable directly** — those documents live in
  the *peer's* registry, where the admin's session holds no data grants.
  Bridged by `services/ReciprocalMirror.ts`: server-side sync (with the
  **org's** session) copies each reciprocal registration and its grants
  into graphs in the org's store, so the admin's AA reads them via SPARQL.
- **Peers' data registries — content (`contains` + data instance
  documents): NOT readable directly** — those live on the peer's data
  server. The mirrors deliberately do **not** cover them (registry
  metadata only). Bridged by `/.sai/proxy-admin`: the org's server
  fetches them with the **org's** credentials (the grantee) and serves
  them to the admin's side.

`/.sai/sparql-admin` and `/.sai/proxy-admin` are the org server's two
faces for the admin's AA to pull org-authority data across that boundary:
SPARQL for the (mirror-backed) registry plane, proxied HTTP for the data
plane. Both are called **by the admin's AA over HTTP** (authenticating as
the admin) — the admin's server never holds the org's session, and the two
sessions never share a handler/service: in the single-server dev/test env
the calls are same-origin, in real deployments they cross independent
servers.

## Why phases 1–3 / 4 don't fix it

- **Phase 2 scope guard:** SPARQL reads cover *registry data only*
  (registrations, roles, authorizations, grants). Data-instance
  **content fetches stay plain HTTP GET** — deliberately.
- **Phase 1 mirrors:** replicate the reciprocal registration + linked
  grants (registry metadata). They do **not** cover data registrations'
  `contains` or instance documents — mirrors cover registry metadata only.
  This includes the `getDescriptions` AllFromRegistry count (Problem §2):
  it is a `contains` read of the peer's data registration, not grant
  metadata. Together with the proxy, the two bridges cover everything the
  admin's AA cannot reach on the peer's server (Access model): the mirror
  handles peers' *registry metadata*, the proxy peers' *data content*.
- **Phase 4 (isolated-datasets-and-sparql):** splits stores per owner; the
  peer's data instances move to the peer's dataset, so even the internal
  SPARQL endpoint no longer sees them. The peer-data read plane needs an
  *authorized* path, not just a transport change.

## Federation relevance

`federation.md` shortcut 1 (shared SPARQL store) is what makes
cross-graph *registry metadata* reads work today; the peer's **data
instances** live in the same shared store only while stores are unified.
After the per-owner cutover (`isolated-datasets-and-sparql.md` 4b),
instance reads cross servers entirely — this plan is the data-plane
analogue of the mirror decision (shortcut 1a), applied to instance
content.

The legitimate authority to read is the **data grant** the peer issued to
the org: the org (its AA / its granted session) is the grantee. The open
design question is how the admin's org-context view gets that authority.

The proxy, as implemented, is the *federation-shaped* read path for peer
data:

- **Data plane stays authorized-HTTP; the proxy only swaps credentials.**
  The peer's permission engine authorizes the org's UAS against its data
  grants (federation.md §1) — exactly how any granted agent fetches — so
  `/proxy-admin` never depends on shortcut 1 and survives the 4b per-owner
  cutover by construction. It is the data-plane counterpart of the
  registry-plane split: registry metadata is mirrored / cross-graph
  (shortcuts 1/1a), data-instance content is fetched from the peer's
  server as the grantee.
- **No collision with mirror graphs.** Mirrors and `queries/org.ts` cover
  the reciprocal registrations + linked grants (registry plane); the
  proxy serves registration `contains` + instance documents, which were
  never part of the store.
- **Session-bound upstream (federation.md shortcut 2).** The proxy's
  upstream fetch is the org's `authFetch` (session-bound credentials), not
  the global fetch that `SaiPermissionsEngine`/`AdminPermissionReader` use
  for discovery — consistent with the note that authorized reads must be
  session-bound.
- The only federation-adjacent prerequisite is the direction-4 check
  (the peer's engine actually resolves the org's grants for the granted
  instances) — a seed/visibility question on the peer side, not a
  federation one.

> **Consumption model — the `/sparql-admin` parallel.** Both endpoints
> are used only when the **admin's AA fetches data from the org's AA**: the
> admin side never reads the peer's servers directly — the org's server is
> the bridge. `/sparql-admin` exposes the (mirror-backed) *registry plane*
> of the org's store; `/proxy-admin` exposes the *data plane* fetch with
> the org's credentials. The admin UI never calls either endpoint directly
> (grep: no consumer under `ui/`); consumers are admin-side processes / the
> services layer — e.g. the RPC handlers behind `listDataInstances` peer
> branch, `getDescriptions` counts, `getResource`.

## Candidate directions (decision: 2 — server-side proxy)

1. **Shared-store SPARQL listing (pre-4b only).** Read the registration's
   `contains` + instance *labels* via the internal endpoint (extending the
   phase-2 `queries/org.ts` pattern to data-registration / data-instance
   graphs). Works only while shortcut 1 holds; requires revisiting the
   "content stays HTTP" scope guard (labels are content-ish); dies at 4b.
2. **Org-as-grantee proxy (server-side).** The org's server fetches the
   peer's data registration/instances with the **org's** credentials (the
   grantee — authorized by the peer's data grants) and serves the results
   to the admin's org-context UI. Needs a server-side org credential
   holder / request-scoped org session for *data-plane* reads only —
   distinct from the phase-3 "no second session" rule, which governs the
   registry plane. This is the "proxy" the plan is named for. Read-only
   in scope: the proxy never carries org-context writes onto peer servers
   (scope note in Problem). Serves the listing (`listDataInstances`
   labels) and the single-instance full-body read (`getResource`) alike —
   the grantee authority covers both.
3. **Extend mirrors to data registrations/instances.** Org-local snapshots
   of peer data-registration `contains` (+ labels, or full documents);
   keeps reads local and survives 4b, at the cost of freshness/staleness
   (extend the phase-1 `syncReciprocalMirror` machinery + its
   staleness/backfill open items) and storage growth.
4. **Grantee visibility (peer engine).** Data registries/instances are
   authorized by **data grants** — data registries do not use ACRs — so
   the prerequisite is that the peer's permission engine resolves the
   org's grants for the granted instances (federation.md §1: the engine
   reads grants from the store). A seed/visibility gap today would 403;
   folded into `/test` parity. Does not help the admin directly — still
   needs the proxy authority (2) for the admin's session.

**Decision: direction 2 (proxy), read-only** — implemented as
`/.sai/proxy-admin` (below). Direction 4 (grantee visibility) is a
*prerequisite* for the proxy to return 200 on affected instances, not an
alternative authority model. Directions 1 and 3 are not chosen: 1 is a
pre-4b-only metadata stopgap; 3 trades staleness/storage for locality.

## Implementation — `/.sai/proxy-admin`

Route `GET /.sai/proxy-admin/<base64url-org-webid>?iri=<peer-resource>`
(router `^/.sai/proxy-admin/.*`, `GET` only, read-only by construction —
the proxy never issues writes upstream).

- **Gate** (extracted from `AdminSparqlHandler` into
  `services/adminGate.ts`, shared with `/sparql-admin`):
  `requireOrgAdmin` — the caller must be an admin of the org
  (non-empty `hasAdminGrant` on the org's social-agent registration of
  the caller; unknown org indistinguishable from non-admin) — plus
  `orgWebIdFromPath` (base64url last segment, query/fragment-stripped).
- **Upstream:** `sessionManager.getSession(orgWebId)` mints the **org's**
  saiSession server-side; `orgSession.fetch(target)` carries the org's UAS
  — the grantee, authorized by the peer's data grants. The admin's UAS
  never touches the peer's server. JSON-LD only: `Accept:
  application/ld+json` is pinned upstream and the response is served as
  `application/ld+json` — no Accept forwarding, no content-type
  passthrough, binary/other representations out of scope.
- **Errors:** upstream 404 → NotFound; any other non-ok (notably 403 when
  the org is not actually granted — the direction-4 hygiene gap) →
  Forbidden with the upstream status/detail surfaced to the UI.
- **Security:** target IRI must be absolute http(s); GET only; peer-side
  access is enforced by the peer's permission engine against its data
  grants (safe-by-grant — the org's credentials only succeed where the
  org holds a grant; no peer allow-list). The phase-2 scope-guard
  rationale is preserved and strengthened: data stays on authorized
  credential paths — the credential is now the org's.
- **Consumption: server-side, like `/sparql-admin`.** The RPC services
  (`listDataInstances` peer branch, `getDescriptions` counts,
  `getResource`) are the intended consumers — they use the
  org-credentialed data-plane fetch that backs this endpoint, the way the
  registry plane is consumed server-side via SPARQL. The UI keeps
  talking to `/.sai/api` only and never hits this endpoint directly (the
  same relationship the UI has with `/sparql-admin` today). The
  YoYo-side upstream fetch is extracted: `services/peerFetch.ts`
  (`fetchPeerResource`), used by `ProxyAdminHandler` (`PeerFetchError` is
  in `.componentsignore`). The admin side has its client:
  `services/peerProxy.ts` (`fetchPeerDocument` — discovers the org's AA,
  builds `/.sai/proxy-admin/<org>?iri=<target>`, GETs it with the admin's
  session). The admin's AA never contacts the peer directly and never
  mints the org's session locally: the org's server is the only party
  whose credentials the peer's data grants authorize (the grantee), so
  this is the data-plane leg of "admin's AA fetches from the org's AA" —
  a cross-server HTTP call authenticated as the admin.

## Scope guard to settle

- Does "peer-instance listing" enter org-context scope at all (metadata:
  `contains` + labels — vs full document bodies)? Currently **no**
  (mirrors cover registry metadata only); the §2.4 debt stands until this
  is decided. The `Inherited` scope already reads parent instance
  **content** (`frameDataInstance`) — full bodies, not labels — so the
  metadata-vs-bodies line must be drawn *inside* `listDataInstances`, not
  only at the case boundary.
- The same guard applies to the other read paths in Problem §2–3
  (`getDescriptions` count, `getResource` single-instance): they are data
  plane, and any transport change must keep access-controlled data on
  authorized HTTP/credential paths.
- `listDataInstances` **content** is the data plane; changes to its
  transports must not regress the phase-2 scope guard's rationale
  (access-controlled data stays on authorized HTTP/credential paths).

## Tests

- `/test` (user-run): **done — org-context proxy parity suite green.**
  `ListDataInstances` on a peer's granted registration (labels, all
  scopes), `GetAuthorizationData` AllFromRegistry count == direct count
  (was 0), `GetResource` full-body on a peer-granted instance, and the
  `/.sai/proxy-admin` endpoint contract (200 JSON-LD / 403 / 400s). Run in
  `test/org-context.test.ts`; the seed gained `registry/bob/grant/t2v9cd`
  (Bob → YoYo, AllFromRegistry over `data/bob/avn9hv/`).
  Same for the other read paths: `GetAuthorizationData` AllFromRegistry
  counts over a peer registration (was 0 — dead `contains` fallback, fixed
  in step 2), and `GetResource` on a peer-granted instance (403 today;
  read resolved in step 3 — org-side `accessGrantedTo` from the org's data
  authorizations via SPARQL, see Rollout step 3).
- `/.sai/proxy-admin` endpoint cases: admin GET of a peer registration /
  instance the org is granted → 200 with the upstream body + content-type;
  non-admin / unknown org → 403 (indistinguishable); non-GET → 405;
  missing / relative / non-http `iri` → 400; upstream 404 / 403 surfaced;
  upstream non-`application/ld+json` content-type → 400 (JSON-LD-only
  contract); requests with a non-JSON-LD `Accept` still get JSON-LD.
- Post-4b: cross-owner instance read (org admin lists the peer's granted
  instances across datasets; isolation — nothing outside grants).

## Open items

- **Authority model: decided — direction 2 (proxy).** Remaining: the
  direction-4 **grantee-visibility check** (does the peer's engine
  resolve the org's grants for the granted instances? seed check —
  federation.md §1; data registries/instances are authorized by data
  grants, not ACRs): without it the proxy 403s on the very registries it
  is meant to serve. Folded into `/test` parity.
- Dan-side client: implemented — `services/peerProxy.ts`
  (`fetchPeerDocument`, `PeerProxyError` in `.componentsignore`), wired
  into all three data-plane paths (rollout steps 2–3: `getDescriptions`
  counts, `listDataInstances` peer branch, `getResource`). The org-context
  RPC services call `/proxy-admin` on the org's server over HTTP,
  authenticated as the admin (the admin's own session — the only session
  the admin's server holds). The org session is never minted on the
  admin's server and never coexists with the admin's session in one
  handler/service — Dan's AA and YoYo's AA are independent servers in
  real deployments; the single-server dev/test env makes these same-origin
  self-calls but must keep the same boundary.
- **JSON-LD only (decided).** Binary/other representations are out of
  scope for now: the endpoint pins `Accept: application/ld+json` upstream
  and serves `application/ld+json`; `isBlob` data instances are not
  proxied.
- Whether the phase-2 scope guard's "data-instance content stays HTTP"
  clause gets an org-context exception — partly answered: the proxy keeps
  the data on authorized HTTP credential paths (the org's).
- Mirror extension scope (metadata vs full content) and its staleness
  policy — not chosen; retained only as a 4b-compatible fallback if the
  proxy hits unsolvable grant gaps — links to
  `isolated-datasets-and-sparql.md` open items.
- **Last step — registry-plane SPARQL reads go via `/sparql-admin` —
  done.** `queries/org.ts` now runs on a `SparqlTransport` and every
  org-context consumer (`DataRegistry`, `Authorization`, `AgentRegistry`,
  `ShareResource`) passes `sparqlTransportFor(ctx)`: personal → the
  session's internal endpoint (unchanged); org context → YoYo's
  `/sparql-admin` over HTTP `QUERY` with the admin's session (AA
  discovery + base64url org webId, `application/sparql-query` body;
  `application/sparql-results+json` and `text/turtle` responses parsed
  back into the local term/store shapes). `QUERY` is the safe, read-only
  method (draft-ietf-httpapi-safe-methods-wg); it became DPoP-verifiable
  once `@solid/access-token-verifier` 2.1.2 added it to its
  `REQUEST_METHOD` whitelist (previously the client had to use `POST`,
  since a DPoP-bound `QUERY` request failed verification and the gate
  403'd). The endpoint now accepts `QUERY` only
  (`allowedMethods: ["QUERY"]`). Same results in the
  single-server dev/test env (both resolve the shared store); cross-server
  in real deployments, and it resolves against the org's graphs/mirrors
  held by the org's server after the 4b cutover. Unit-verified
  (`packages/components/test/peer-proxy.test.ts`: bindings, literal/lang
  terms, CONSTRUCT turtle, non-ok surfaces the status).

## Rollout — three green steps

Each step ends with the full suite green (build + package vitest in
`packages/components/test`, runnable by the agent; `/test` parity cases
user-run):

1. **Endpoint + client contract, in isolation — no service changes.**
   Unit-test `fetchPeerResource`, `fetchPeerDocument` (AA discovery, URL
   build, status mapping) and the JSON-LD-only content-type guard
   (`packages/components/test/peer-proxy.test.ts`). Services untouched →
   every existing suite stays green by construction.
2. **`getDescriptions` AllFromRegistry count — done.** The count was
   silently 0 for `AllFromRegistry` (dead `contains` fallback —
   `hasDataInstance` defaults to `[]`, and `[]` is truthy); `scopeOfGrant`
   is now the discriminator and the `contains` read goes through a shared
   `dataRegistrationContains` helper: personal → direct factory deref,
   org context → `fetchPeerDocument(ctx.session, ctx.webId,
   hasDataRegistration)` + parse-only `DataRegistration.fromJsonLd(doc,
   iri)`. Personal context untouched. Unit-verified
   (`packages/components/test/peer-proxy.test.ts`: org → proxy path +
   parse, personal → no proxy, upstream status propagation); `/test`
   parity: org-context `GetAuthorizationData` AllFromRegistry count ==
   direct count.
3. **`listDataInstances` peer branch + `getResource` via the client —
   done.** Org path iterates with `peerInstanceIris` (`AllFromRegistry`
   via `dataRegistrationContains`, `SelectedFromRegistry` from grant
   metadata, `Inherited` walks the parent grant + parent content through
   `/proxy-admin`) and labels via `peerInstanceNode` + `labelFromNode`;
   shape trees stay on the admin-session factory (public). `getResource`
   org path fetches the registration + instance docs via the client and
   frames from the fetched docs; org-context `accessGrantedTo` is the
   ORG's data authorizations covering the resource, read via SPARQL
   (`agentsWithAccessMatching` + `orgAgentsWithAccess` — the mirrored
   switch of `AA.findAgentsWithAccess`, filtered to registered social
   agents; in real deployments over `/sparql-admin`). Added a fetch-less
   framing variant `DataInstance.frameDataInstanceFromDoc(doc, iri,
   shapeTree)` to data-model (`frameDataInstance` now delegates to it).
   Unit-verified: `peerInstanceIris` all three scopes +
   `agentsWithAccessMatching`; `/test` parity: peer listing
   (labels/counts, all scopes) + `GetResource` full-body.