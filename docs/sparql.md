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
- `adminSparqlTransport(session, orgWebId)` — HTTP POST
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
  `getDataAuthorization`, `findSocialAgentRegistration`) is one query fn +
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
