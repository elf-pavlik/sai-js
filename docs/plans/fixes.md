# Fixes — invitation lookup via the registry plane (remove the HTTP scan)

> **Status:** design only. No code changed. Captures the follow-up from the
> `invitation-accept` diagram review (`docs/temporal.c4`, step 5): the accept
> flow already reads invitations over the registry plane, but the write-path
> duplicate check still uses the HTTP list-and-scan twin in
> `packages/authorization-agent/src/agent-registry.ts`. Remove the scan and
> route the check through the SPARQL `fetchSocialAgentInvitation`.

## 1. Problem

`findSocialAgentInvitation` in `packages/authorization-agent/src/agent-registry.ts`
(as well as its `socialAgentInvitations` generator) list-and-scans invitations
over HTTP: `linkedIrisJsonLd` on the agent registry container (GET +
`interop:hasSocialAgentInvitation`) then one `loadSocialAgentInvitation` GET
per candidate until `capabilityUrl` matches. The same lookup already exists as
a registry-plane (SPARQL) twin in `sparql.ts` — and that is what the runtime
accept path actually uses:

- `InvitationHandler` (`packages/components/src/InvitationHandler.ts`) →
  `sai.findSocialAgentInvitation(capabilityUrl)` — the session method
  (`authorization-agent.ts:205`) already wraps the SPARQL variant over the
  session's internal endpoint;
- components' org-context reads (`services/queries/org.ts`) already import and
  re-export the SPARQL variant.

The only remaining runtime consumer of the HTTP scan is the idempotency check
in the write path `addSocialAgentInvitation` (`agent-registry.ts:185`) — one
function, one caller, with mirrored semantics already implemented in SPARQL.

## 2. Current state (as-is)

- **HTTP scan** — `agent-registry.ts:84`
  `findSocialAgentInvitation(data, fetch, capabilityUrl)` →
  `socialAgentInvitations` (`agent-registry.ts:50`, the `linkedIrisJsonLd`
  generator) → `loadSocialAgentInvitation` per invitation.
- **SPARQL twin** — `sparql.ts:279`
  `findSocialAgentInvitation(transport, containerIri, capabilityUrl)` — today
  it mirrors the HTTP scan: `listSocialAgentInvitations` (one SELECT over the
  container graph + its `meta:` graph) → `getSocialAgentInvitation`
  (`graphDoc`) per candidate → JS scan on `capabilityUrl`. §3.2 moves the
  capabilityUrl match into the query. Same `SocialAgentInvitationData` POJO
  on both transports (framing).
- **Dependencies** — `DataModelDependencies` (`authorization-agent/src/types.ts`)
  carries `fetch` + `randomUUID` only; there is no SPARQL endpoint in scope for
  the write-path functions.
- **Consumers** — runtime: `addSocialAgentInvitation` (`agent-registry.ts:185`)
  — the duplicate guard before PUT; tests:
  `agent-registry.test.ts:35` (`should provide socialAgentInvitations`, on the
  generator) and the skipped `describe.skip('findSocialAgentInvitation')`
  (`agent-registry.test.ts:66`). Session-level `findSocialAgentInvitation`
  coverage lives in `authorization-agent.test.ts:835` (SPARQL path).

## 3. Change

1. **Remove** `findSocialAgentInvitation` from `agent-registry.ts`, and the
   now-dead `socialAgentInvitations` generator (its only consumer is the
   removed function plus the test above).
2. **Match `capabilityUrl` in the SPARQL query, as `fetchSocialAgentInvitation`**
   — rewrite the SPARQL `findSocialAgentInvitation` (`sparql.ts:279`) into a
   `CONSTRUCT` that matches the capability URL **and** returns every triple of
   the matched graph in one round trip — no `hasSocialAgentInvitation`
   listing, no `meta:`-graph handling, and no separate graph read, since the
   invitation body lives in its own resource-named graph
   (`GRAPH <invitation-iri>`). The result is framed to the
   `SocialAgentInvitationData` POJO as usual. A non-matching capabilityUrl
   returns an empty graph instead of scanning every invitation. The name
   follows the semantics: it no longer *locates* a match to read later, it
   **fetches** the document — rename to `fetchSocialAgentInvitation` across
   `sparql.ts`, the session method (`authorization-agent.ts:205`),
   `InvitationHandler`, and the `queries/org.ts` re-export:

   ```sparql
   PREFIX interop: <https://www.w3.org/ns/solid/interop#>

   CONSTRUCT {
     ?s ?p ?o
   } WHERE {
     GRAPH ?g {
       ?invitation interop:hasCapabilityUrl <${capabilityUrl}> .
       ?s ?p ?o
     }
   }
   ```

   Caveat: CONSTRUCT merges triples from every matching graph — acceptable
   since each invitation's capabilityUrl is unique (a SELECT would keep the
   matched `?g` visible for duplicate detection, at the cost of a second read).

3. **Thread the SPARQL endpoint into the write path** — let
   `addSocialAgentInvitation` take the endpoint (optional `sparqlEndpoint`
   on `DataModelDependencies`) and run its duplicate check via the plane:

   ```ts
   const existing = await fetchSocialAgentInvitation(
     localSparqlTransport(deps.sparqlEndpoint!),
     capabilityUrl
   )
   ```

4. **Components** — `services/AgentRegistry.ts` `createInvitation` builds the
   deps with `sparqlEndpoint: ctx.session.sparqlEndpoint` (the session already
   exposes it publicly, `authorization-agent.ts:76`).

Writes stay HTTP (PUT the invitation, SPARQL PATCH the
`hasSocialAgentInvitation` container link) — only the read moves to the plane.

## 4. Design decisions

- **Read via the plane, write via fetch** — consistent with the transport
  split already settled in the AA (reads = SPARQL registry plane, writes =
  HTTP/SPARQL update).
- **Endpoint via deps, not a new session method** — `addSocialAgentInvitation`
  is a standalone AA module function on `DataModelDependencies`; adding the
  endpoint keeps the fix minimal. A session `createSocialAgentInvitation`
  (SPARQL guard + PUT + link + ACR in one session method, mirroring
  `fetchSocialAgentInvitation`) remains a possible later consolidation — out of
  scope here.
- **Remove the generator with the scan** — `socialAgentInvitations` is the
  scan's listing half; keeping it would preserve the exact divergence this
  plan removes. It is exported package API, so flag it in the release notes;
  flip to "keep" if external consumers are known to use it.

## 5. Testing

- `agent-registry.test.ts`: drop `should provide socialAgentInvitations`
  (generator removal) and the skipped `findSocialAgentInvitation` describe.
- `authorization-agent.test.ts` (session `fetchSocialAgentInvitation`): extend
  coverage to assert the **write-path** duplicate rejection now goes through
  the plane — `addSocialAgentInvitation` with an existing `capabilityUrl`
  throws before any PUT.
- `sparql.ts` unit: the `CONSTRUCT` (§3.2) returns every triple of the graph
  whose invitation matches `interop:hasCapabilityUrl`, and an empty graph when
  the capabilityUrl is unknown (no per-candidate scan).
- Gate: full build + AA/components vitest + `/test` integration
  (`invitation-accept` keeps passing — its read path was already SPARQL).

## 6. Out of scope / follow-ups

- Sibling scans in the same module (`findSocialAgentRegistration`,
  `socialAgentRegistrations`) are out of scope for this fix; they share the
  pattern and are candidates for the same treatment (`queries/org.ts` already
  re-exports their SPARQL twins).
- Docs: promote the "invitations candidate" note in `docs/sparql.md` to
  current; `docs/temporal.c4` step 5 (accept view) already uses the direct
  capabilityUrl-matching `CONSTRUCT` (§3.2).