# SPARQL read plane — one query, endpoint chosen by context

Consolidates the SPARQL read architecture (org-context-sparql.md phases 2–3)
around a single principle: **the same registry query runs against whichever
endpoint the context requires.** Only the endpoint differs — never the query,
never the mapping.

## Transport abstraction

The transport + registry query core lives in
`packages/authorization-agent/src/sparql.ts` (the AA owns `sparqlEndpoint`):

- `SparqlTransport` — two ops: `fetchBindings` (SELECT) and `fetchTriples`
  (CONSTRUCT). Query functions are **endpoint-agnostic**: each takes a
  `transport` as its first arg and never mentions an endpoint.
- `localSparqlTransport(endpoint)` — internal endpoint via
  `SparqlEndpointFetcher` (used for **personal** context and the AA's own
  session reads).
- `adminSparqlTransport(session, orgWebId)` — HTTP `QUERY`
  `application/sparql-query` to `/.sai/sparql-admin/<base64url-org>`,
  authenticated as the admin (used for **org** context); lives in
  `packages/components/src/services/queries/org.ts`.
- One dispatch decides between them (`ctx.webId === ctx.userWebId`):

```ts
export function sparqlTransportFor(ctx: ResolvedContext): SparqlTransport {
  return ctx.webId === ctx.userWebId
    ? localSparqlTransport(ctx.session.sparqlEndpoint) // personal → internal
    : adminSparqlTransport(ctx.session, ctx.webId)      // org → /sparql-admin
}
```

## Consequences

- **Same query, only endpoint differs** — every registry read
  (`graphDoc`, `listContained`, `getSocialAgentRegistration`, `getDataGrant`,
  `getDataAuthorization`, `getRole`, `findSocialAgentRegistration`) is one
  query fn +
  either `localSparqlTransport`/`adminSparqlTransport` via
  `sparqlTransportFor(ctx)` (service call sites — AgentRegistry, DataRegistry,
  Authorization, ShareResource) or `localSparqlTransport(session.sparqlEndpoint)`
  (the AA's own `findSocialAgentRegistration` — same query the services use,
  running against the session's internal endpoint).
- **IRI-parametrized** — queries are keyed by resource/graph IRI, never by
  `session.webId`, so they resolve unchanged to mirror graphs at the 4b
  per-owner split.
- **Writes stay REST/LDP** (enforcement path); only registry-set reads use
  SPARQL. Storage description, webid/client-id, shape-tree and data-instance
  content stay HTTP.

## Current state

- **Org context** reads registry metadata via SPARQL → `/sparql-admin`.
- **Personal context** now uses the **same query functions** — `sparqlTransportFor`
  routes them to the session's **internal** endpoint (its own store). The former
  `personal ? HTTP (factory) : SPARQL` branches were removed from the registry
  reads that already had a SPARQL counterpart (`AgentRegistry`, `DataRegistry`,
  `Authorization`, `ShareResource`): reciprocal bodies, linked grants, agent
  registrations, and the "who has access" authorization reads.
- Still HTTP by design: data-instance **content** (peer instance iteration
  stays `Grant.getDataInstanceIterator` / `/proxy-admin`), webid/client-id
  profiles, shape-tree descriptions, storage descriptions, and all **writes**
  (REST/LDP, enforcement path).
- Session-level reads reusing the same queries over the internal endpoint:
  `findRole` (single graph read by IRI), `findAgentsWithAccess` /
  `findSocialAgentsWithAccess` (auth-registry + agent-registry listings),
  `generateAuthorization`'s existing-authorization lookup, and the admin gate
  `Context.ts`/`isAdminOf` (both hops now via `getSocialAgentRegistration`).

## Hygiene

- `const transport = sparqlTransportFor(ctx)` is **hoisted out of loops** in
  `getSocialAgents` (AgentRegistry), `getDescriptions` (Authorization) and
  `dataGrantIndexForAgent` / `getReciprocalGrantsSparql` / `listDataInstances`
  (DataRegistry); `listSocialAgentRegistrations` and `orgAgentsWithAccess`
  already did. Remaining `sparqlTransportFor(ctx)` calls are one-off single
  reads, not in loop bodies.
- `revokeGrants` is handed `sparqlEndpoint` directly — a **write** to the
  data owner's store (`GrantRevocationHandler`), correctly outside this
  read-plane abstraction.

## What's left / not yet done

Recommended order (each step keeps tests green: the package vitest in
`/packages` plus the matching `/test` integration file via dagger). All four
steps are **done** and their dagger `/test` suites pass (maintainer-run); the
`authorization-agent` vitest covers steps 2 and 4 (the step 1 and 3 unit
tests live in `components/test`).

Remaining candidates are worked one by one, same discipline: tests green per
step, and a **caller check** on any data-model HTTP function replaced.

Each step ends with a **caller check**: `codegraph_callers` on every
data-model HTTP function the step replaced — the verdict (still-used /
orphaned) is recorded in the step's entry below. Orphaned functions stay as
public API (the data-model package is published; removal is a deliberate
breaking change) until a cleanup decision is made — we are free to modify
data-model as needed, so cleanup may be scheduled explicitly.

1. **Roles listing** — **done** (`RoleRegistry.getRoles` reads via `listContained` +
   `getRole` through `sparqlTransportFor` — no new queries; unit test in
   `components/test/role-registry.test.ts`; dagger `/test/roles.test.ts`,
   `/test/org-context.test.ts` (ListRoles)).
2. **`findAuthorizationsForAgent`** — **done** (authorizations half reuses
   `listContained` + `getDataAuthorization`; role membership is the new
   `findRolesWithMember` SELECT; the HTTP `roles` getter was removed — it
   had no other consumers; unit test in `authorization-agent/test`; dagger
   `/test/services.test.ts`, `/test/authorization.test.ts`).
3. **`findApplicationRegistration`** — **done** (new `listApplicationRegistrations`
   query — `interop:hasApplicationRegistration` in both graphs only, exact
   parity with the HTTP `linkedIrisJsonLd` read, since runtime writes patch
   that predicate into the container — plus `getApplicationRegistration`
   framing via data-model `ApplicationRegistration.fromJsonLd`, mirroring
   `findSocialAgentRegistration` / `getSocialAgentRegistration`; wired in
   the AA method served by `AgentIdHandler` and in `getApplications`;
   per-app profiles still dereference the client-id document over HTTP;
   invitation reads were done later the same way (candidate 1 below); unit
   tests in `authorization-agent`
   and `components/test/agent-registry.test.ts`; dagger `/test/agents.test.ts`,
   `/test/authorization.test.ts`, `/test/delegation-endpoint.test.ts`).
4. **`findDataRegistration` + own data-registry listings** (`buildDataRegistry`,
   `findUserDataRegistrations`) — **done** (new `listDataRegistrations` query —
   `interop:hasDataRegistration` in both graphs only, exact parity with the
   HTTP `hasDataRegistration` read, since runtime writes
   (`DataRegistry.createRegistration`) patch that predicate into the
   container — plus `getDataRegistration` framing via data-model
   `DataRegistration.fromJsonLd`; wired in the AA `findDataRegistration`
   (share flow) and in `buildDataRegistry` / `findUserDataRegistrations`;
   storage description for the registry label stays HTTP data-plane; unit
   tests in `authorization-agent` and `components/test/data-registry.test.ts`;
   dagger `/test/share.test.ts`, `/test/authorization.test.ts`, agents/data
   registry RPC tests).

Replaced data-model functions — remaining callers (steps 1–4, candidates, final cleanup):

- `RoleRegistry.roles` (step 1) — **removed in the final cleanup** (its only
  remaining caller was `test/org-context.test.ts`, reworked to an admin
  `authFetch` of the role registry).
- `AuthorizationRegistry.dataAuthorizations` / `findDataAuthorizations` /
  `findAuthorizationsDelegatingFromOwner` / `getDataAuthorizations` /
  `isDataAuthorization` (steps 2–3, candidates 2–3) — **removed in the
  final cleanup**: candidates 2–3 removed the last src consumers, leaving
  only data-model tests (also removed). The kept `getDataAuthorizationIris` /
  `adminAuthorizations` / `getGranted` still serve the AdminAuthorization
  paths.
- `AgentRegistry.applicationRegistrations` (step 3) — the unconsumed AA
  getter was **removed**; the data-model fn **stays** as the internal engine
  of `findApplicationRegistration` (still load-bearing via
  `recordAuthorization` + `findRegistration`).
- `AgentRegistry.findApplicationRegistration` (step 3) — **still used**: the
  `recordAuthorization` existence check (kept HTTP) and data-model internals.
- `AgentRegistry.socialAgentInvitations` / `findSocialAgentInvitation`
  (candidate 1) — the unconsumed AA getter was **removed**; the data-model
  fns **stay** as the internal engine of `addSocialAgentInvitation`'s
  existence check.
- `AgentRegistry.socialAgentRegistrations` (data-model) — **still used**: the
  HTTP listing at `data-authorization.ts:197` (grant generation, AllFromRole
  member resolution) and via `findRegistration` (typeGrantee), plus
  data-model internals/tests.
- `DataRegistry.registrations` (step 4) — **still used**: grant generation
  (`data-model/src/data-authorization.ts:329`, `generateGrantsForAuthorization`
  — matches the authorization's registration/shape-tree against the registry
  set's data registrations over HTTP; live via the AA `generateDataGrants`
  path) and data-model internals (`registeredShapeTrees`,
  `createRegistration`). The grant-generation listing work — this read plus
  the `AgentRegistry.socialAgentRegistrations` sweep in
  `generateDelegatedDataGrants` (`data-authorization.ts:197`) — moved to
  `docs/plans/reorganize-authz-agent-logic.md` (step 1).

Additional candidates (post-plan, one by one; same discipline):

1. **Invitation reads** (`getSocialAgentInvitations`, AA
   `findSocialAgentInvitation`) — **done** (new `listSocialAgentInvitations`
   query — `interop:hasSocialAgentInvitation` in both graphs only, parity with
   the HTTP `linkedIrisJsonLd` read — plus `getSocialAgentInvitation` framing
   via data-model `SocialAgentInvitation.fromJsonLd`, whose namespace export
   was added, and `findSocialAgentInvitation` list-and-match on
   `capabilityUrl` served by `InvitationHandler`). Caller check:
   `AgentRegistry.socialAgentInvitations` / `findSocialAgentInvitation` —
   **still used** by data-model internals (`findSocialAgentInvitation`
   iteration, `addSocialAgentInvitation` existence check) + data-model
   tests (the unconsumed AA getter was removed in the final cleanup).
   Unit tests in `authorization-agent` and
   `components/test/agent-registry.test.ts`; dagger `/test/invitation.test.ts`.
2. **`findRoleUsage`'s authorization sweep** — **done** (the role-deletion
   guard in `temporal/activities/grants.ts` now uses the registry plane:
   `listContained` + `getDataAuthorization` over the session's internal
   endpoint, type-filtered for parity with the HTTP `dataAuthorizations`
   iterator). Caller check: `AuthorizationRegistry.dataAuthorizations` —
   **still used**, but only as the internal engine of
   `findDataAuthorizations` / `findAuthorizationsDelegatingFromOwner`
   (candidate 3 removes those consumers — see below). Unit test in
   `components/test/grants.test.ts` (session manager + SPARQL fetcher
   mocked); dagger `/test/roles.test.ts` (role deletion).
3. **`findAffectedGrantees`' delegation sweep** — **done** (the
   delegation/sharing activity in `temporal/activities/grants.ts` now reads
   the registry-plane listing over the session's internal endpoint,
   replicating `findAuthorizationsDelegatingFromOwner`'s match semantics:
   exclude `grantee === peer`, match `dataOwner === peer`, and All-scope
   authorizations only when no roleId — the updateDelegatedGrants path).
   Caller check: with candidate 2 this removes **every src caller** of the
   data-model authorization-listing cluster —
   `findAuthorizationsDelegatingFromOwner` and `findDataAuthorizations` are
   now **orphaned in src** (data-model tests only) and `dataAuthorizations`
   survives only as their internal engine — cleanup at the end. Unit tests
   in `components/test/grants.test.ts` (data-model registries stubbed for
   `typeGrantee`); dagger `/test/services.test.ts` (delegation),
   `/test/authorization.test.ts`.

Out of scope (documented, deliberately not scheduled):

- **`findGrantForResource` / `findShapeTreeForResource` / `findResourceOwner` /
  `findResourceServerOwner` (peer leg)** — the storage→shape-tree chain had
  **zero callers today** (verified with `codegraph_callers` per symbol:
  `findShapeTreeForResource` — the chain root — has no callers;
  `findGrantForResource` / `findResourceOwner` are called only by
  `findShapeTreeForResource`; `findResourceServerOwner` only by
  `findResourceOwner`; `findDataRegistrationForResource`'s only caller is
  `findShapeTreeForResource`). **Removed in the final cleanup**, together with
  the unconsumed `applicationRegistrations` / `socialAgentInvitations` /
  `socialAgentRegistrations` AA getters. Opportunistic instead — if the
  storage→shape-tree resolution ever re-enters use: the peer-grant leg
  (match grants by `hasStorage`) is a graph SELECT; `findResourceOwner`'s
  local leg (storage-description discovery) would stay HTTP data-plane.
- **`ReciprocalMirror` (dormant)** — replace its hand-rolled fetcher reads with
  `localSparqlTransport` + `graphDoc`/`listContained`; not wired, so no
  behavior change — optional cleanup, do last if at all.
- **Iterator-level 404/410 tolerance** — stale-`ldp:contains` after
  authorization replacement/deletion makes listing consumers 404 and kills
  workflows; skip gone IRIs instead (deferred; see
  `improve-fetch-json-ld.md`). `generateDataGrants` tolerance kept reverted
  per decision.
- **`/sparql-admin` consumers at 4b** — org-context reads switch to it
  (authenticated as the admin) at the per-owner split
  (`isolated-datasets-and-sparql.md`).
