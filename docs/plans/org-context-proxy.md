# Org-context data-instance reads — peer-data proxy

> **Status:** direction decided (server-side proxy) — the `/.sai/proxy-admin`
> endpoint and the shared admin gate are implemented in `packages/components`;
> UI/server integration not started. Extracted from the
> `org-context-sparql.md` §2.4 known issue (org-context `listDataInstances`
> on peers' registries) + its linked open item ("whether peer-instance
> content listing ever enters org-context scope"). No test currently
> requires this behavior; upstream phases 1–3 are done/in-flight and are
> prerequisites.

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

- the peer's data-server ACRs grant `(peer, peerUAS)` (and grantee
  identities); the admin matches nothing → **403**;
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
   for `AllFromRegistry` grants is `factory.dataRegistration(
   hasDataRegistration).contains.length`, an HTTP read of the peer's data
   registration. Fires whenever a peer is a data owner in the org-context
   authorization flow. `SelectedFromRegistry` counts come from grant
   metadata and are fine.
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

## Why phases 1–3 / 4 don't fix it

- **Phase 2 scope guard:** SPARQL reads cover *registry data only*
  (registrations, roles, authorizations, grants). Data-instance
  **content fetches stay plain HTTP GET** — deliberately.
- **Phase 1 mirrors:** replicate the reciprocal registration + linked
  grants (registry metadata). They do **not** cover data registrations'
  `contains` or instance documents — mirrors cover registry metadata only.
  This includes the `getDescriptions` AllFromRegistry count (Problem §2):
  it is a `contains` read of the peer's data registration, not grant
  metadata.
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

## Candidate directions (decision: 2 — server-side proxy)

1. **Shared-store SPARQL listing (pre-4b only).** Read the registration's
   `contains` + instance *labels* via the internal endpoint (extending the
   phase-2 `queries/org.ts` pattern to data-registration / data-instance
   graphs). Works only while shortcut 1 holds; requires revisiting the
   "content stays HTTP" scope guard (labels are content-ish); dies at 4b.
2. **Org-as-grantee proxy (server-side).** The org's server fetches the
   peer's data registration/instances with the **org's** credentials (the
   grantee — legitimate on the peer's ACRs) and serves the results to the
   admin's org-context UI. Needs a server-side org credential holder /
   request-scoped org session for *data-plane* reads only — distinct from
   the phase-3 "no second session" rule, which governs the registry plane.
   This is the "proxy" the plan is named for. Read-only in scope: the
   proxy never carries org-context writes onto peer servers (scope note in
   Problem). Serves the listing (`listDataInstances` labels) and the
   single-instance full-body read (`getResource`) alike — the grantee
   authority covers both.
3. **Extend mirrors to data registrations/instances.** Org-local snapshots
   of peer data-registration `contains` (+ labels, or full documents);
   keeps reads local and survives 4b, at the cost of freshness/staleness
   (extend the phase-1 `syncReciprocalMirror` machinery + its
   staleness/backfill open items) and storage growth.
4. **Peer ACR hygiene (grantee-first).** Ensure data instances' ACRs
   actually include the grantee (org) so the *org's* session over HTTP
   works on the peer's server. May be a seed/hygiene gap today
   (`registry-set-permissions.md` touches ACR scoping); does not help the
   admin directly — still needs the proxy authority (2) for the admin's
   session.

**Decision: direction 2 (proxy), read-only** — implemented as
`/.sai/proxy-admin` (below). Direction 4 (grantee ACR hygiene) is a
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
  — the grantee, legitimate on the peer's ACRs. The admin's UAS never
  touches the peer's server. `Accept` is forwarded from the request;
  the upstream representation + content-type are returned to the UI.
- **Errors:** upstream 404 → NotFound; any other non-ok (notably 403 when
  the org is not actually granted — the direction-4 hygiene gap) →
  Forbidden with the upstream status/detail surfaced to the UI.
- **Security:** target IRI must be absolute http(s); GET only; peer-side
  access stays enforced by the peer's own ACRs (safe-by-ACL — the org's
  credentials only succeed where the org is granted; no peer allow-list).
  The phase-2 scope-guard rationale is preserved and strengthened: data
  stays on authorized credential paths — the credential is now the org's.
- **Integration (not started):** in org context the UI fetches peer
  data-plane documents (registration `contains`, instance documents)
  through `/proxy-admin`; RPC services (`listDataInstances` peer branch,
  `getDescriptions` counts, `getResource`) keep registry-plane logic. Open:
  whether the data-plane fetches happen client-side (RPC yields instance
  IRIs, UI fetches docs via the proxy) or server-side (RPC gains an
  org-credentialed data-plane fetch for the read scope only).

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

- `/test` (user-run): extend `org-context.test.ts` with a
  `ListDataInstances` case on a peer's registration once a direction
  lands (labeled + counted parity vs today's behavior where it 403s);
  `getDataRegistries(peer)` metadata parity already covered in phases 2–3.
  Same for the other read paths: `GetAuthorizationData` AllFromRegistry
  counts over a peer registration, and `GetResource` on a peer-granted
  instance (both 403 today).
- `/.sai/proxy-admin` endpoint cases: admin GET of a peer registration /
  instance the org is granted → 200 with the upstream body + content-type;
  non-admin / unknown org → 403 (indistinguishable); non-GET → 405;
  missing / relative / non-http `iri` → 400; upstream 404 / 403 surfaced.
- Post-4b: cross-owner instance read (org admin lists the peer's granted
  instances across datasets; isolation — nothing outside grants).

## Open items

- **Authority model: decided — direction 2 (proxy).** Remaining: the
  direction-4 **ACR hygiene check** (are grantees actually in peer data
  instance ACRs today? seed check — adjacent to
  `registry-set-permissions.md`): without it the proxy 403s on the very
  registries it is meant to serve. Folded into `/test` parity.
- Integration point (client- vs server-side data-plane fetches through the
  proxy) — see Implementation.
- Blob/binary passthrough: the handler currently buffers the upstream body
  as text; `isBlob` data instances need streaming with the upstream
  content-type untouched.
- Whether the phase-2 scope guard's "data-instance content stays HTTP"
  clause gets an org-context exception — partly answered: the proxy keeps
  the data on authorized HTTP credential paths (the org's).
- Mirror extension scope (metadata vs full content) and its staleness
  policy — not chosen; retained only as a 4b-compatible fallback if the
  proxy hits unsolvable ACL gaps — links to
  `isolated-datasets-and-sparql.md` open items.