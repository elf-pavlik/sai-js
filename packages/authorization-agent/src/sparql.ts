import {
  ApplicationRegistration,
  type ApplicationRegistrationData,
  DataAuthorization,
  type DataAuthorizationData,
  DataRegistration,
  type DataRegistrationData,
  Grant,
  type GrantData,
  type RoleData,
  SocialAgentInvitation,
  type SocialAgentInvitationData,
  type SocialAgentRegistrationData,
  dataModelContext,
} from '@janeirodigital/interop-data-model'
import { AS, INTEROP, LDP, type LanguageMap, frameDoc } from '@janeirodigital/interop-utils'
/**
 * Registry-plane SPARQL transport + queries, shared by the AuthorizationAgent
 * (session reads its own registry via the internal endpoint) and the
 * components service layer (`sparqlTransportFor` picks local vs `/sparql-admin`
 * per context) — the same queries run against whichever endpoint the context
 * requires (docs/sparql.md).
 */
import type { DatasetCore } from '@rdfjs/types'
import { type IBindings, SparqlEndpointFetcher } from 'fetch-sparql-endpoint'
import * as jsonldNs from 'jsonld'
import { Store } from 'n3'

// CJS/ESM interop: jsonld is a CJS package; in an ESM bundle the namespace
// has the full exports only on .default, while in CJS the namespace is the
// module object directly.
const jsonld = (jsonldNs as any).default ?? jsonldNs

const fetcher = new SparqlEndpointFetcher()

/** The minimal RDF/JS term shape consumers need (`.value` on bindings). */
export type SparqlBindingTerm = {
  termType: string
  value: string
  language?: string
  datatype?: { termType: string; value: string }
}

/**
 * A query runner for the registry plane: SELECT bindings or CONSTRUCT
 * triples. Two implementations:
 *
 * - `localSparqlTransport` — the session's internal endpoint (own registry /
 *   personal context / server-side sessions): reads the graphs of the
 *   session's own store (shared-store shortcut federation.md §1 until 4b);
 * - `adminSparqlTransport` — the **org's** `/sparql-admin` endpoint over
 *   HTTP (org context, in `packages/components/src/services/queries/org.ts`):
 *   the query travels as `application/sparql-query` with the admin's session
 *   credentials, and the org's server resolves it against its own store (the
 *   location of the org's graphs and, post-4b, its mirrors of peers).
 */
export interface SparqlTransport {
  fetchBindings(query: string): Promise<Array<Record<string, SparqlBindingTerm>>>
  fetchTriples(query: string): Promise<DatasetCore>
}

async function arrayifyStream<T>(stream: NodeJS.ReadableStream): Promise<T[]> {
  const items: T[] = []
  // fetch-sparql-endpoint declares its streams as raw node streams; at
  // runtime they are object-mode Readables emitting bindings/quads, so
  // for-await collects the emitted values (same semantics as CSS
  // `arrayifyStream`'s `events.on(stream, 'data')`).
  for await (const item of stream) items.push(item as T)
  return items
}

/** Query runner against an internal SPARQL endpoint (SparqlEndpointFetcher). */
export function localSparqlTransport(sparqlEndpoint: string): SparqlTransport {
  return {
    async fetchBindings(query) {
      const bindingsStream = await fetcher.fetchBindings(sparqlEndpoint, query)
      return arrayifyStream<IBindings>(bindingsStream)
    },
    async fetchTriples(query) {
      const quadsStream = await fetcher.fetchTriples(sparqlEndpoint, query)
      const store = new Store()
      store.addQuads(await arrayifyStream(quadsStream))
      return store
    },
  }
}

/**
 * Fetch one named graph and return it as an expanded JSON-LD document.
 *
 * The graph is named after the source resource IRI (the same IRI we would
 * otherwise HTTP-GET — cf. phase-1 mirror storage shape). GRAPH is only
 * legal in the WHERE clause — the template stays plain triples. Both the
 * resource graph and its `meta:` graph are read: CSS stores container bodies
 * in the meta graph ("where data and metadata overlap",
 * DataAccessorBasedStore) — the seeds put registration bodies in
 * `meta:<iri>` — while document bodies live in `GRAPH <iri>`.
 */
export async function graphDoc(transport: SparqlTransport, iri: string): Promise<unknown> {
  const store = await transport.fetchTriples(
    `CONSTRUCT { ?s ?p ?o } WHERE {
  { GRAPH <${iri}> { ?s ?p ?o } }
  UNION
  { GRAPH <meta:${iri}> { ?s ?p ?o } }
}`
  )
  return jsonld.fromRDF(store)
}

/**
 * Children of a registry container — the registration listing. Reads the
 * server-managed `ldp:contains` quads from the container's REGULAR graph
 * (the single membership home — `meta:` graphs hold type declarations only,
 * access-request-tracking.md §6; docs/sparql.md graph scoping). One query
 * for every dedicated registry: grants, roles, authorizations, and the three
 * agent registries (social-agent, application, invitation — the former
 * `has*Registration` interop predicates are gone).
 */
export async function listContained(
  transport: SparqlTransport,
  containerIri: string
): Promise<string[]> {
  const bindings = await transport.fetchBindings(
    `SELECT DISTINCT ?child WHERE {
  { GRAPH <${containerIri}> { <${containerIri}> <${LDP.contains}> ?child } }
}`
  )
  return bindings.map((binding) => binding.child.value)
}

/**
 * Registration body (e.g. a reciprocal registration) from its graph —
 * framed with the data-model context exactly like `loadSocialAgentRegistration`
 * frames an HTTP-fetched document, so callers receive the same
 * `SocialAgentRegistrationData` POJO on both transports.
 */
export async function getSocialAgentRegistration(
  transport: SparqlTransport,
  iri: string
): Promise<SocialAgentRegistrationData> {
  const doc = await graphDoc(transport, iri)
  const node = (await frameDoc(doc, dataModelContext, iri)) as Record<string, unknown>
  return {
    id: iri,
    type: (node.type as string[] | undefined) ?? [],
    registeredAgent: node.registeredAgent as string,
    hasDataGrant: (node.hasDataGrant as string[]) ?? [],
    hasAdminGrant: (node.hasAdminGrant as string[]) ?? [],
    label: (node.label as LanguageMap | undefined) ?? {},
    note: (node.note as string | undefined) ?? undefined,
    reciprocalRegistration: (node.reciprocalRegistration as string | undefined) ?? undefined,
  }
}

/**
 * Find the registration of `webId` in the given social-agent registry
 * container (match on `interop:registeredAgent`). Simple list-and-scan: the
 * peer registration bodies may live in `meta:` graphs, which a `GRAPH ?r`
 * join would miss, and the registries are small.
 */
export async function findSocialAgentRegistration(
  transport: SparqlTransport,
  socialAgentRegistryContainerIri: string,
  webId: string
): Promise<SocialAgentRegistrationData | undefined> {
  for (const iri of await listContained(transport, socialAgentRegistryContainerIri)) {
    const registration = await getSocialAgentRegistration(transport, iri)
    if (registration.registeredAgent === webId) return registration
  }
}

/**
 * Application registration body from its graph — framed via the
 * data-model's own `ApplicationRegistration.fromJsonLd`, producing the same
 * `ApplicationRegistrationData` POJO as `factory.applicationRegistration`.
 */
export async function getApplicationRegistration(
  transport: SparqlTransport,
  iri: string
): Promise<ApplicationRegistrationData> {
  const doc = await graphDoc(transport, iri)
  return ApplicationRegistration.fromJsonLd(doc, iri)
}

/**
 * Find the registration of application `webId` in the given application
 * registry container (match on `interop:registeredAgent`) — list-and-scan
 * over the server-managed `ldp:contains` listing (docs/sparql.md step 3).
 */
export async function findApplicationRegistration(
  transport: SparqlTransport,
  applicationRegistryContainerIri: string,
  webId: string
): Promise<ApplicationRegistrationData | undefined> {
  for (const iri of await listContained(transport, applicationRegistryContainerIri)) {
    const registration = await getApplicationRegistration(transport, iri)
    if (registration.registeredAgent === webId) return registration
  }
}

/**
 * Social-agent invitation body from its graph — framed via the
 * data-model's own `SocialAgentInvitation.fromJsonLd`, producing the same
 * `SocialAgentInvitationData` POJO as `factory.socialAgentInvitation`.
 */
export async function getSocialAgentInvitation(
  transport: SparqlTransport,
  iri: string
): Promise<SocialAgentInvitationData> {
  const doc = await graphDoc(transport, iri)
  return SocialAgentInvitation.fromJsonLd(doc, iri)
}

/**
 * Find the invitation with `capabilityUrl` in the given invitation registry
 * container — list-and-scan over the server-managed `ldp:contains`
 * listing, matching the HTTP `findSocialAgentInvitation` read
 * (docs/sparql.md, invitations candidate; served by `InvitationHandler`).
 */
export async function findSocialAgentInvitation(
  transport: SparqlTransport,
  invitationRegistryContainerIri: string,
  capabilityUrl: string
): Promise<SocialAgentInvitationData | undefined> {
  for (const iri of await listContained(transport, invitationRegistryContainerIri)) {
    const invitation = await getSocialAgentInvitation(transport, iri)
    if (invitation.capabilityUrl === capabilityUrl) return invitation
  }
}

/**
 * Data registration body from its graph — framed via the data-model's own
 * `DataRegistration.fromJsonLd` (same POJO as `factory.dataRegistration`):
 * `registeredShapeTree` plus `contains` (the contained data instances, the
 * server-managed `ldp:contains` of the registration's graphs).
 */
export async function getDataRegistration(
  transport: SparqlTransport,
  iri: string
): Promise<DataRegistrationData> {
  const doc = await graphDoc(transport, iri)
  return DataRegistration.fromJsonLd(doc, iri)
}

/**
 * Data grant body from its graph — framed via the data-model's own
 * `Grant.fromJsonLd`, producing the same `GrantData` POJO as
 * `factory.dataGrant`. Grants are immutable, so a present graph is current.
 */
export async function getDataGrant(transport: SparqlTransport, iri: string): Promise<GrantData> {
  const doc = await graphDoc(transport, iri)
  return Grant.fromJsonLd(doc, iri)
}

/**
 * Data authorization body from its graph — framed via the data-model's own
 * `DataAuthorization.fromJsonLd`, producing the same
 * `DataAuthorizationData` POJO as `factory.dataAuthorization`. Tolerant of
 * other contained resources (e.g. AdminAuthorizations share the
 * authorization registry container — they frame with empty optional fields
 * and are filtered by type/shapeTree at the call site).
 */
export async function getDataAuthorization(
  transport: SparqlTransport,
  iri: string
): Promise<DataAuthorizationData> {
  const doc = await graphDoc(transport, iri)
  return DataAuthorization.fromJsonLd(doc, iri)
}

/**
 * Role IRIs in the given role registry whose membership includes `member`
 * (`interop:hasMember`). One SELECT (docs/sparql.md step 2): the container
 * membership — `ldp:contains` in the container's REGULAR graph (the single
 * membership home, access-request-tracking.md §6 — no `meta:` read) — is
 * joined with the `hasMember` triple living in each role's own graph, so the
 * result is scoped to this registry set's roles (the store is shared across
 * owners). The roles listing would be N graph reads, so this is deliberately
 * a new query, not pure reuse.
 * The `FILTER(?g = ?role)` self-graph guard is the authoritative-read
 * convention (docs/sparql.md — graph scoping): WITHOUT it, a real-id
 * embedded projection inside an activity graph (step 2 — the role-to-be on
 * `roleMembershipChanged`) asserts the membership from the activity's graph
 * and keeps matching forever (activities are immutable) — a phantom
 * membership the deny path would act on.
 */
export async function findRolesWithMember(
  transport: SparqlTransport,
  roleRegistryContainerIri: string,
  member: string
): Promise<string[]> {
  const bindings = await transport.fetchBindings(
    `SELECT DISTINCT ?role WHERE {
  { GRAPH <${roleRegistryContainerIri}> { <${roleRegistryContainerIri}> <${LDP.contains}> ?role } }
  { GRAPH ?g { ?role <${INTEROP.hasMember}> <${member}> } }
  FILTER(?g = ?role)
}`
  )
  return bindings.map((binding) => binding.role.value)
}

/**
 * Child data authorizations of `parent` — the FORWARD direction
 * (`interop:inheritsFromAuthorization` on the child). The reliable child
 * source: the parent's `@reverse` `hasInheritingAuthorization` is dropped by
 * the ACTIVITY framing on embedded nodes (and may be absent on older stored
 * parents), while the child's forward link always survives — querying it
 * covers every storage state without re-migration (grant-generation.ts
 * `inheritingAuthorizations`).
 */
export async function findInheritingAuthorizations(
  transport: SparqlTransport,
  parentIri: string
): Promise<string[]> {
  const bindings = await transport.fetchBindings(
    `SELECT ?child WHERE {
  GRAPH ?g {
    ?child <${INTEROP.inheritsFromAuthorization}> <${parentIri}> .
  }
}`
  )
  return bindings.map((binding) => binding.child.value)
}

/**
 * Role body from its graph — framed like `crud/role.ts`'s `fromJsonLd`
 * (same frame + POJO shape), producing the same `RoleData` as
 * `factory.role`. The graph is keyed by the role's own IRI, so a lookup by
 * IRI is a single graph read — no container scan. Returns `undefined` when
 * the role's graph no longer exists (deleted role: the CONSTRUCT yields an
 * empty document, which `frameDoc` would otherwise reject).
 */
export async function getRole(
  transport: SparqlTransport,
  iri: string
): Promise<RoleData | undefined> {
  const doc = await graphDoc(transport, iri)
  if (Array.isArray(doc) && doc.length === 0) return undefined
  const node = (await frameDoc(doc, dataModelContext, iri)) as any
  const type = (node.type as string[] | undefined) ?? []
  // Type guard: ANY non-empty graph at the IRI is not a role. In dev the
  // app's client-id document lives at the application IRI (map.json maps
  // `https://data/test-client/public/id` → `https://vuejectron.docker/id`),
  // so a tolerant frame returned a pseudo-role — `typeGrantee` then resolved
  // an APPLICATION as `Role` and skipped its auto-registration fallback.
  if (!type.includes('Role') && !type.includes(INTEROP.Role)) return undefined
  return {
    id: iri,
    type,
    label: (node.label as LanguageMap | undefined) ?? {},
    members: node.members ?? [],
  }
}

// ──────────────────────────
// Grant reads for delegation/revocation (Phase 4 — moved from handlers)
// ──────────────────────────

/** Authority-relevant fields of grants loaded from the registry. */
export type GrantAuthority = {
  dataOwner: string
  grantedBy: string
  grantee: string
}

/**
 * Load the authority-relevant fields of the given grants (iri → binding).
 * Grants that do not exist (already removed) are absent from the result.
 */
export async function getGrantsAuthority(
  transport: SparqlTransport,
  iris: string[]
): Promise<Map<string, GrantAuthority>> {
  if (iris.length === 0) return new Map()
  const values = iris.map((iri) => `<${iri}>`).join(' ')
  const bindings = await transport.fetchBindings(
    `SELECT ?grant ?dataOwner ?grantedBy ?grantee WHERE {
    GRAPH ?g {
      ?grant
        <${INTEROP.dataOwner}> ?dataOwner;
        <${INTEROP.grantedBy}> ?grantedBy;
        <${INTEROP.grantee}> ?grantee .
    }
    VALUES ?grant { ${values} }
  }`
  )
  const result = new Map<string, GrantAuthority>()
  for (const binding of bindings) {
    result.set(binding.grant.value, {
      dataOwner: binding.dataOwner.value,
      grantedBy: binding.grantedBy.value,
      grantee: binding.grantee.value,
    })
  }
  return result
}

/**
 * All grants in the registry whose `inheritsFromGrant` points at any of the
 * given parents.
 */
export async function findInheritingChildren(
  transport: SparqlTransport,
  parents: string[]
): Promise<string[]> {
  if (parents.length === 0) return []
  const values = parents.map((iri) => `<${iri}>`).join(' ')
  const bindings = await transport.fetchBindings(
    `SELECT ?child WHERE {
    GRAPH ?g {
      ?child <${INTEROP.inheritsFromGrant}> ?parent .
    }
    VALUES ?parent { ${values} }
  }`
  )
  return bindings.map((binding) => binding.child.value)
}

/**
 * Whether an upstream grant covering the given (delegated) grant exists in the
 * data owner's registry — `requester === grantedBy` and the grant's
 * registration/modes/scope/instances are covered by a source grant
 * (moved from GrantIssuanceHandler.validateDelegable).
 */
export async function findDelegableGrant(
  transport: SparqlTransport,
  grant: GrantData
): Promise<boolean> {
  const accessModes = (grant.accessMode ?? []).map((m) => `<${m}>`).join(' ')

  const requiredInstances = grant.hasDataInstance?.length
    ? grant.hasDataInstance.map((i) => `<${i}>`).join(' ')
    : ''

  const selectedScopeConstraint = requiredInstances
    ? `
          FILTER NOT EXISTS {
            VALUES ?required { ${requiredInstances} }
            FILTER NOT EXISTS {
              ?s <${INTEROP.hasDataInstance}> ?required .
            }
          }
      `
    : ''

  const scopeBlock =
    grant.scopeOfGrant === INTEROP.SelectedFromRegistry
      ? `
        {
          ?s <${INTEROP.scopeOfGrant}> <${INTEROP.AllFromRegistry}> .
        }
        UNION
        {
          ?s <${INTEROP.scopeOfGrant}> <${INTEROP.SelectedFromRegistry}> .
          ${selectedScopeConstraint}
        }
      `
      : `
        ?s <${INTEROP.scopeOfGrant}> <${grant.scopeOfGrant}> .
      `

  const query = `
  SELECT * WHERE {
    GRAPH ?g {
      ?s
        <${INTEROP.dataOwner}> <${grant.dataOwner}>;
        <${INTEROP.grantee}> <${grant.grantedBy}>;
        <${INTEROP.registeredShapeTree}> <${grant.registeredShapeTree}>;
        <${INTEROP.hasStorage}> <${grant.hasStorage}>;
        <${INTEROP.hasDataRegistration}> <${grant.hasDataRegistration}>;
        <${INTEROP.accessMode}> ?mode .

      VALUES ?mode { ${accessModes} }

      ${scopeBlock}
    }
  }
  `
  const bindings = await transport.fetchBindings(query)
  return bindings.length > 0
}

/**
 * One open sent access request (requester plane — §3.1 of
 * access-request-tracking.md): the `NeedBasedAccessRequestSent` activity WITH
 * its embedded request snapshot (grantee/grantedBy/dataOwner + the per-need
 * registeredShapeTrees) that has NO referencing resolution activity
 * (`AccessRequestGranted`/`AccessRequestArchived`). The open-set source for
 * `accessRequestsSent` and the `detectGrantedRequests` detector.
 *
 * The FILTER NOT EXISTS is the "open" guard: a resolution activity in ANY
 * graph referencing the same snapshot id (the join anchor — the resolution
 * object is the light `{ id, type }` projection of the Sent activity's
 * SNAPSHOT id) closes the span, so the request drops out of the set.
 */
export type OpenSentAccessRequest = {
  /** the Sent activity IRI */
  sent: string
  /** the request SNAPSHOT id (urn:uuid) — the stable archive/grant target */
  request: string
  grantee: string
  grantedBy: string
  dataOwner: string
  /** the request's registered shape trees (need-group intersection) */
  shapeTrees: string[]
}

export async function getOpenSentAccessRequests(
  transport: SparqlTransport
): Promise<OpenSentAccessRequest[]> {
  const query = `
SELECT DISTINCT ?sent ?request ?grantee ?grantedBy ?dataOwner ?shapeTree WHERE {
  GRAPH ?g {
    ?sent a <${INTEROP.NeedBasedAccessRequestSent}> ;
          <${AS.object}> ?request .
    ?request a <${INTEROP.NeedBasedAccessRequest}> ;
             <${INTEROP.grantee}> ?grantee ;
             <${INTEROP.grantedBy}> ?grantedBy ;
             <${INTEROP.dataOwner}> ?dataOwner ;
             <${INTEROP.hasAccessNeedGroup}> ?needGroup .
    ?needGroup <${INTEROP.hasAccessNeed}> ?need .
    ?need <${INTEROP.registeredShapeTree}> ?shapeTree .
  }
  # still open — no granted/archived activity referencing the same snapshot
  FILTER NOT EXISTS {
    GRAPH ?g2 {
      VALUES ?resolutionClass { <${INTEROP.AccessRequestGranted}> <${INTEROP.AccessRequestArchived}> }
      ?outcome a ?resolutionClass ; <${AS.object}> ?request .
    }
  }
}`
  const bindings = await transport.fetchBindings(query)
  const byRequest = new Map<string, OpenSentAccessRequest>()
  for (const b of bindings) {
    const key = b.request.value
    const entry = byRequest.get(key) ?? {
      sent: b.sent.value,
      request: key,
      grantee: b.grantee.value,
      grantedBy: b.grantedBy.value,
      dataOwner: b.dataOwner.value,
      shapeTrees: [],
    }
    entry.shapeTrees.push(b.shapeTree.value)
    byRequest.set(key, entry)
  }
  return [...byRequest.values()]
}

/**
 * OPEN need-based access requests in the owner's AccessRequestRegistry
 * (incoming — §3.1 of access-request-tracking.md): the container's
 * `ldp:contains` members (regular graph only) that have NO
 * `AuthorizationGranted`/`AuthorizationDenied` with the flat
 * `satisfiesAccessRequest` back-link. Replaces the removed store-wide
 * `getAccessRequestsOnRegistry` (which listed everything — the "never
 * clears" cause).
 */
export async function getOpenAccessRequestsOnRegistry(
  transport: SparqlTransport,
  accessRequestRegistryContainerIri: string
): Promise<{ id: string; grantee: string }[]> {
  const query = `
SELECT DISTINCT ?request ?grantee WHERE {
  GRAPH <${accessRequestRegistryContainerIri}> {
    <${accessRequestRegistryContainerIri}> <${LDP.contains}> ?request .
  }
  GRAPH ?request {
    ?request a <${INTEROP.NeedBasedAccessRequest}> ;
             <${INTEROP.grantee}> ?grantee .
  }
  # still open — no granted/denied activity referencing it
  FILTER NOT EXISTS {
    GRAPH ?resolution {
      VALUES ?resolutionClass { <${INTEROP.AuthorizationGranted}> <${INTEROP.AuthorizationDenied}> }
      ?resolution a ?resolutionClass ;
                  <${INTEROP.satisfiesAccessRequest}> ?request .
    }
  }
}`
  const bindings = await transport.fetchBindings(query)
  return bindings.map((b) => ({ id: b.request.value, grantee: b.grantee.value }))
}

/**
 * The grants received by `webId` across the requester's plane (§3.2 of
 * access-request-tracking.md) — the grantor's DataGrants naming the
 * requester as `grantee` (the dev/test env resolves them via the
 * shared-store shortcut, federation.md §1). Feeds the detector's
 * best-effort match (§3.3): `grantedBy` (the owner) + per-grant
 * `registeredShapeTree`.
 */
export async function getDataGrantsForGrantee(
  transport: SparqlTransport,
  webId: string
): Promise<{ grant: string; grantedBy: string; shapeTree: string }[]> {
  const query = `
SELECT DISTINCT ?grant ?grantedBy ?shapeTree WHERE {
  GRAPH ?g {
    ?grant a <${INTEROP.DataGrant}> ;
           <${INTEROP.grantee}> <${webId}> ;
           <${INTEROP.grantedBy}> ?grantedBy ;
           <${INTEROP.registeredShapeTree}> ?shapeTree .
  }
}`
  const bindings = await transport.fetchBindings(query)
  return bindings.map((b) => ({
    grant: b.grant.value,
    grantedBy: b.grantedBy.value,
    shapeTree: b.shapeTree.value,
  }))
}
