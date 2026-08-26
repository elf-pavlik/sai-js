import type { AuthorizationAgent } from '@janeirodigital/interop-authorization-agent'
import type { DatasetCore } from '@rdfjs/types'
import {
  DataAuthorization,
  dataModelContext,
  Grant,
  type DataAuthorizationData,
  type GrantData,
  type SocialAgentRegistrationData,
} from '@janeirodigital/interop-data-model'
import { discoverAuthorizationAgent, frameDoc, parseTurtle } from '@janeirodigital/interop-utils'
import { arrayifyStream } from '@solid/community-server'
import { SparqlEndpointFetcher, type IBindings } from 'fetch-sparql-endpoint'
import * as jsonldNs from 'jsonld'
import { Store } from 'n3'
import { INTEROP } from '@janeirodigital/interop-utils'
import type { ResolvedContext } from '../Context.js'

// CJS/ESM interop: jsonld is a CJS package; in an ESM bundle the namespace
// has the full exports only on .default, while in CJS the namespace is the
// module object directly. Same pattern as packages/utils/src/jsonld-parser.ts.
const jsonld = (jsonldNs as any).default ?? jsonldNs

const fetcher = new SparqlEndpointFetcher()

/**
 * ldp:contains — containment triples live in the container's own graph
 * (SparqlDataAccessor.sparqlInsert); seeded containers also carry the
 * interop member link in their `meta:` graph (containers: "data and metadata
 * overlap"). Both are read, across both graphs.
 */
const LDP_CONTAINS = 'http://www.w3.org/ns/ldp#contains'
const INTEROP_HAS_SOCIAL_AGENT_REGISTRATION = INTEROP.hasSocialAgentRegistration

// ──────────────────────────
// SPARQL transports
// ──────────────────────────

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
 * - `localSparqlTransport` — the admin server's own internal endpoint
 *   (personal context / tests): only sees the org's graphs while the
 *   shared-store shortcut (federation.md §1) holds;
 * - `adminSparqlTransport` — the **org's** `/sparql-admin` endpoint over
 *   HTTP (org context): the query travels as `application/sparql-query`
 *   with the admin's session credentials, and the org's server resolves it
 *   against its own store (the location of the org's graphs and, post-4b,
 *   its mirrors of peers). This is the registry-plane leg of "admin's AA
 *   fetches from the org's AA" (org-context-proxy.md last step).
 */
export interface SparqlTransport {
  fetchBindings(query: string): Promise<Array<Record<string, SparqlBindingTerm>>>
  fetchTriples(query: string): Promise<DatasetCore>
}

/** Query runner against an internal SPARQL endpoint (SparqlEndpointFetcher). */
function localSparqlTransport(sparqlEndpoint: string): SparqlTransport {
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
 * Send a SPARQL query to the org's `/sparql-admin` endpoint via HTTP
 * `POST`, authenticated as the admin (the caller's own session — the only
 * session the admin's server holds). `POST` rather than `QUERY`: the
 * access-token verifier whitelists only standard methods (`QUERY` is not
 * in its `REQUEST_METHOD` set), so a DPoP-bound `QUERY` request fails
 * verification and the gate 403s.
 */
async function adminSparqlQuery(
  adminSession: AuthorizationAgent,
  orgWebId: string,
  query: string
): Promise<Response> {
  let orgAA: string | undefined
  try {
    orgAA = await discoverAuthorizationAgent(orgWebId, adminSession.fetch)
  } catch {
    throw new Error(`cannot discover authorization agent for ${orgWebId}`)
  }
  if (!orgAA) {
    throw new Error(`cannot discover authorization agent for ${orgWebId}`)
  }
  const url = `${new URL(orgAA).origin}/.sai/sparql-admin/${Buffer.from(orgWebId).toString('base64url')}`
  const response = await adminSession.fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/sparql-query',
      Accept: 'application/sparql-results+json, text/turtle',
    },
    body: query,
  })
  if (!response.ok) {
    throw new Error(`sparql-admin ${response.status} for ${orgWebId}: ${await response.text()}`)
  }
  return response
}

/** W3C SPARQL JSON-results term → minimal RDF/JS-style term. */
function termFromJson(term: Record<string, string>): SparqlBindingTerm {
  switch (term.type) {
    case 'uri':
      return { termType: 'NamedNode', value: term.value }
    case 'bnode':
      return { termType: 'BlankNode', value: term.value }
    case 'literal': {
      const language = term['xml:lang']
      if (language) {
        return {
          termType: 'Literal',
          value: term.value,
          language,
          datatype: {
            termType: 'NamedNode',
            value: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#langString',
          },
        }
      }
      return {
        termType: 'Literal',
        value: term.value,
        language: '',
        datatype: {
          termType: 'NamedNode',
          value: term.datatype ?? 'http://www.w3.org/2001/XMLSchema#string',
        },
      }
    }
    default:
      throw new Error(`unknown SPARQL result term: ${JSON.stringify(term)}`)
  }
}

/**
 * Query runner against the org's `/sparql-admin` endpoint
 * (`AdminSparqlHandler`: SELECT → `application/sparql-results+json`,
 * CONSTRUCT → `text/turtle`; updates rejected).
 */
function adminSparqlTransport(adminSession: AuthorizationAgent, orgWebId: string): SparqlTransport {
  return {
    async fetchBindings(query) {
      const response = await adminSparqlQuery(adminSession, orgWebId, query)
      const json = (await response.json()) as {
        head: { vars: string[] }
        results?: { bindings: Record<string, Record<string, string>>[] }
        boolean?: boolean
      }
      if (json.boolean !== undefined) {
        throw new Error(`unexpected ASK result for query: ${query}`)
      }
      return (json.results?.bindings ?? []).map((binding) =>
        Object.fromEntries(
          Object.entries(binding).map(([name, term]) => [name, termFromJson(term)])
        )
      )
    },
    async fetchTriples(query) {
      const response = await adminSparqlQuery(adminSession, orgWebId, query)
      return parseTurtle(await response.text())
    },
  }
}

/**
 * The registry-plane transport for a resolved context: personal context
 * reads the user's own store locally; org context queries the org's
 * `/sparql-admin` over HTTP as the admin (cross-server in real
 * deployments, same-origin in the single-server dev/test env — the shared
 * store makes both resolve the org's graphs).
 */
export function sparqlTransportFor(ctx: ResolvedContext): SparqlTransport {
  return ctx.webId === ctx.userWebId
    ? localSparqlTransport(ctx.session.sparqlEndpoint)
    : adminSparqlTransport(ctx.session, ctx.webId)
}

// ──────────────────────────
// Graph / registration / grant reads
// ──────────────────────────

/**
 * Fetch one named graph and return it as an expanded JSON-LD document.
 *
 * The graph is named after the source resource IRI (the same IRI we would
 * otherwise HTTP-GET — cf. phase-1 mirror storage shape). Resolved against
 * the context's registry-plane transport: the org's store (via
 * `/sparql-admin`), which holds the org's own graphs and — post-4b — the
 * org's mirrors of its peers.
 */
async function graphDoc(transport: SparqlTransport, iri: string): Promise<unknown> {
  // GRAPH is only legal in the WHERE clause — the template stays plain
  // triples. Both the resource graph and its `meta:` graph are read:
  // CSS stores container bodies in the meta graph ("where data and metadata
  // overlap", DataAccessorBasedStore) — the seeds put registration bodies
  // in `meta:<iri>` — while document bodies live in `GRAPH <iri>`.
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
 * Children of a registry container — the registration listing. Reads both
 * the container graph and its `meta:` graph, and both the generic
 * `ldp:contains` and the interop member predicate (seeds/HTTP-served
 * containers store membership in the meta graph, runtime-created ones in
 * the plain graph via `SparqlDataAccessor`).
 */
export async function listContained(transport: SparqlTransport, containerIri: string): Promise<string[]> {
  const bindings = await transport.fetchBindings(
    `SELECT DISTINCT ?child WHERE {
  { GRAPH <${containerIri}> { <${containerIri}> <${LDP_CONTAINS}> ?child } }
  UNION
  { GRAPH <meta:${containerIri}> { <${containerIri}> <${LDP_CONTAINS}> ?child } }
  UNION
  { GRAPH <${containerIri}> { <${containerIri}> <${INTEROP_HAS_SOCIAL_AGENT_REGISTRATION}> ?child } }
  UNION
  { GRAPH <meta:${containerIri}> { <${containerIri}> <${INTEROP_HAS_SOCIAL_AGENT_REGISTRATION}> ?child } }
}`
  )
  return bindings.map((binding) => binding.child.value)
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
 * Data grant body from its graph — framed via the data-model's own
 * `Grant.fromJsonLd`, producing the same `GrantData` POJO as
 * `factory.dataGrant`. Grants are immutable, so a present graph is current.
 */
export async function getDataGrant(transport: SparqlTransport, iri: string): Promise<GrantData> {
  const doc = await graphDoc(transport, iri)
  return Grant.fromJsonLd(doc, iri)
}

/**
 * Data authorization body from its graph — framed via the data-model's
 * own `DataAuthorization.fromJsonLd`, producing the same
 * `DataAuthorizationData` POJO as `factory.dataAuthorization`. Used by the
 * org-context "who has access" list (`ShareResource.getResource`).
 */
export async function getDataAuthorization(
  transport: SparqlTransport,
  iri: string
): Promise<DataAuthorizationData> {
  const doc = await graphDoc(transport, iri)
  return DataAuthorization.fromJsonLd(doc, iri)
}