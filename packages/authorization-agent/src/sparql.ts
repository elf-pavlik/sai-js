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
import { INTEROP, LDP, frameDoc } from '@janeirodigital/interop-utils'
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
 * Children of a registry container — the registration listing. Reads both
 * the container graph and its `meta:` graph, and both the generic
 * `ldp:contains` and the interop member predicate (seeds/HTTP-served
 * containers store membership in the meta graph, runtime-created ones in
 * the plain graph via `SparqlDataAccessor`).
 */
export async function listContained(
  transport: SparqlTransport,
  containerIri: string
): Promise<string[]> {
  const bindings = await transport.fetchBindings(
    `SELECT DISTINCT ?child WHERE {
  { GRAPH <${containerIri}> { <${containerIri}> <${LDP.contains}> ?child } }
  UNION
  { GRAPH <meta:${containerIri}> { <${containerIri}> <${LDP.contains}> ?child } }
  UNION
  { GRAPH <${containerIri}> { <${containerIri}> <${INTEROP.hasSocialAgentRegistration}> ?child } }
  UNION
  { GRAPH <meta:${containerIri}> { <${containerIri}> <${INTEROP.hasSocialAgentRegistration}> ?child } }
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
    type: node.type ? (Array.isArray(node.type) ? node.type : [node.type]) : [],
    registeredAgent: node.registeredAgent as string,
    hasDataGrant: (node.hasDataGrant as string[]) ?? [],
    hasAdminGrant: (node.hasAdminGrant as string[]) ?? [],
    prefLabel: (node.prefLabel as string) ?? '',
    note: (node.note as string | undefined) ?? undefined,
    hasAccessNeedGroup: (node.hasAccessNeedGroup as string | undefined) ?? undefined,
    reciprocalRegistration: (node.reciprocalRegistration as string | undefined) ?? undefined,
  }
}

/**
 * Find the registration of `webId` in the given agent registry container
 * (match on `interop:registeredAgent`). Simple list-and-scan: the peer
 * registration bodies may live in `meta:` graphs, which a `GRAPH ?r` join
 * would miss, and the registries are small.
 */
export async function findSocialAgentRegistration(
  transport: SparqlTransport,
  agentRegistryContainerIri: string,
  webId: string
): Promise<SocialAgentRegistrationData | undefined> {
  for (const iri of await listContained(transport, agentRegistryContainerIri)) {
    const registration = await getSocialAgentRegistration(transport, iri)
    if (registration.registeredAgent === webId) return registration
  }
}

/**
 * Children of an agent registry container linked as application
 * registrations — `interop:hasApplicationRegistration` in both the
 * container graph and its `meta:` graph (docs/sparql.md step 3). Seeded
 * agent registries list membership via the interop predicates **only**,
 * with no `ldp:contains` (`environments/data/registry.trig`), and the
 * runtime write path (`addApplicationRegistration`) patches the same
 * predicate into the container — so this listing reads it, and only it,
 * matching the HTTP `linkedIrisJsonLd(..., 'hasApplicationRegistration')`
 * read exactly. The social-agent counterpart reads `ldp:contains` +
 * `hasSocialAgentRegistration`; deliberately not generalized — a merged
 * listing would hand social-agent registrations to the application
 * framing, whose callers then dereference their `registeredAgent` as a
 * client-id document.
 */
export async function listApplicationRegistrations(
  transport: SparqlTransport,
  containerIri: string
): Promise<string[]> {
  const bindings = await transport.fetchBindings(
    `SELECT DISTINCT ?child WHERE {
  { GRAPH <${containerIri}> { <${containerIri}> <${INTEROP.hasApplicationRegistration}> ?child } }
  UNION
  { GRAPH <meta:${containerIri}> { <${containerIri}> <${INTEROP.hasApplicationRegistration}> ?child } }
}`
  )
  return bindings.map((binding) => binding.child.value)
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
 * Find the registration of application `webId` in the given agent registry
 * container (match on `interop:registeredAgent`) — the symmetric query for
 * application registrations mirroring `findSocialAgentRegistration`
 * (docs/sparql.md step 3).
 */
export async function findApplicationRegistration(
  transport: SparqlTransport,
  agentRegistryContainerIri: string,
  webId: string
): Promise<ApplicationRegistrationData | undefined> {
  for (const iri of await listApplicationRegistrations(transport, agentRegistryContainerIri)) {
    const registration = await getApplicationRegistration(transport, iri)
    if (registration.registeredAgent === webId) return registration
  }
}

/**
 * Children of an agent registry container linked as social-agent
 * invitations — `interop:hasSocialAgentInvitation` in both the container
 * graph and its `meta:` graph (docs/sparql.md, invitations candidate).
 * Same storage shape as the other agent-registry memberships: seeded
 * containers list invitations via the interop predicate only, and the
 * runtime write path (`AgentRegistry.addSocialAgentInvitation`) patches
 * the same predicate into the container — matching the HTTP
 * `linkedIrisJsonLd(..., 'hasSocialAgentInvitation')` read exactly.
 */
export async function listSocialAgentInvitations(
  transport: SparqlTransport,
  containerIri: string
): Promise<string[]> {
  const bindings = await transport.fetchBindings(
    `SELECT DISTINCT ?child WHERE {
  { GRAPH <${containerIri}> { <${containerIri}> <${INTEROP.hasSocialAgentInvitation}> ?child } }
  UNION
  { GRAPH <meta:${containerIri}> { <${containerIri}> <${INTEROP.hasSocialAgentInvitation}> ?child } }
}`
  )
  return bindings.map((binding) => binding.child.value)
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
 * Find the invitation with `capabilityUrl` in the given agent registry
 * container — list-and-scan over the `hasSocialAgentInvitation` listing,
 * matching the HTTP `findSocialAgentInvitation` read (docs/sparql.md,
 * invitations candidate; served by `InvitationHandler`).
 */
export async function findSocialAgentInvitation(
  transport: SparqlTransport,
  agentRegistryContainerIri: string,
  capabilityUrl: string
): Promise<SocialAgentInvitationData | undefined> {
  for (const iri of await listSocialAgentInvitations(transport, agentRegistryContainerIri)) {
    const invitation = await getSocialAgentInvitation(transport, iri)
    if (invitation.capabilityUrl === capabilityUrl) return invitation
  }
}

/**
 * Children of a data registry container linked as data registrations —
 * `interop:hasDataRegistration` in both the container graph and its `meta:`
 * graph (docs/sparql.md step 4). Seeded data registries list membership via
 * the interop predicate only, with no `ldp:contains`
 * (`environments/data/registry.trig`), and the runtime write path
 * (`DataRegistry.createRegistration`) patches the same predicate into the
 * container — matching the HTTP `hasDataRegistration` read exactly.
 */
export async function listDataRegistrations(
  transport: SparqlTransport,
  dataRegistryContainerIri: string
): Promise<string[]> {
  const bindings = await transport.fetchBindings(
    `SELECT DISTINCT ?child WHERE {
  { GRAPH <${dataRegistryContainerIri}> { <${dataRegistryContainerIri}> <${INTEROP.hasDataRegistration}> ?child } }
  UNION
  { GRAPH <meta:${dataRegistryContainerIri}> { <${dataRegistryContainerIri}> <${INTEROP.hasDataRegistration}> ?child } }
}`
  )
  return bindings.map((binding) => binding.child.value)
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
 * membership — `ldp:contains` in both `GRAPH <container>` and
 * `GRAPH <meta:container>` — is joined with the `hasMember` triple living
 * in each role's own graph, so the result is scoped to this registry set's
 * roles (the store is shared across owners). The roles listing would be N
 * graph reads, so this is deliberately a new query, not pure reuse.
 */
export async function findRolesWithMember(
  transport: SparqlTransport,
  roleRegistryContainerIri: string,
  member: string
): Promise<string[]> {
  const bindings = await transport.fetchBindings(
    `SELECT DISTINCT ?role WHERE {
  { GRAPH <${roleRegistryContainerIri}> { <${roleRegistryContainerIri}> <${LDP.contains}> ?role } }
  UNION
  { GRAPH <meta:${roleRegistryContainerIri}> { <${roleRegistryContainerIri}> <${LDP.contains}> ?role } }
  { GRAPH ?g { ?role <${INTEROP.hasMember}> <${member}> } }
}`
  )
  return bindings.map((binding) => binding.role.value)
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
  return {
    id: iri,
    type: node.type ? (Array.isArray(node.type) ? node.type : [node.type]) : [],
    prefLabel: node.prefLabel ?? '',
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
  const accessModes = grant.accessMode.map((m) => `<${m}>`).join(' ')

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
