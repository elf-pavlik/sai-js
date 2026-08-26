import {
  dataModelContext,
  Grant,
  type GrantData,
  type SocialAgentRegistrationData,
} from '@janeirodigital/interop-data-model'
import { frameDoc } from '@janeirodigital/interop-utils'
import { arrayifyStream } from '@solid/community-server'
import { SparqlEndpointFetcher } from 'fetch-sparql-endpoint'
import * as jsonldNs from 'jsonld'
import { Store } from 'n3'

// CJS/ESM interop: jsonld is a CJS package; in an ESM bundle the namespace
// has the full exports only on .default, while in CJS the namespace is the
// module object directly. Same pattern as packages/utils/src/jsonld-parser.ts.
const jsonld = (jsonldNs as any).default ?? jsonldNs

const fetcher = new SparqlEndpointFetcher()

/**
 * Fetch one named graph and return it as an expanded JSON-LD document.
 *
 * The graph is named after the source resource IRI (the same IRI we would
 * otherwise HTTP-GET — cf. phase-1 mirror storage shape). Queried against
 * the session's internal endpoint (the shared store holds the peers' live
 * graphs — federation.md shortcut 1); the same query resolves to mirror
 * graphs unchanged once they activate at 4b.
 */
async function graphDoc(sparqlEndpoint: string, iri: string): Promise<unknown> {
  // GRAPH is only legal in the WHERE clause — the template stays plain
  // triples. Both the resource graph and its `meta:` graph are read:
  // CSS stores container bodies in the meta graph ("where data and metadata
  // overlap", DataAccessorBasedStore) — the seeds put registration bodies
  // in `meta:<iri>` — while document bodies live in `GRAPH <iri>`.
  const quadsStream = await fetcher.fetchTriples(
    sparqlEndpoint,
    `CONSTRUCT { ?s ?p ?o } WHERE {
  { GRAPH <${iri}> { ?s ?p ?o } }
  UNION
  { GRAPH <meta:${iri}> { ?s ?p ?o } }
}`
  )
  const store = new Store()
  store.addQuads(await arrayifyStream(quadsStream))
  return jsonld.fromRDF(store)
}

/**
 * Registration body (e.g. a reciprocal registration) from its graph —
 * framed with the data-model context exactly like `loadSocialAgentRegistration`
 * frames an HTTP-fetched document, so callers receive the same
 * `SocialAgentRegistrationData` POJO on both transports.
 */
export async function getSocialAgentRegistration(
  sparqlEndpoint: string,
  iri: string
): Promise<SocialAgentRegistrationData> {
  const doc = await graphDoc(sparqlEndpoint, iri)
  const node = (await frameDoc(doc, dataModelContext, iri)) as Record<string, unknown>
  return {
    id: iri,
    type: node.type ? (Array.isArray(node.type) ? node.type : [node.type]) : [],
    registeredAgent: node.registeredAgent as string,
    hasDataGrant: (node.hasDataGrant as string[]) ?? [],
    prefLabel: (node.prefLabel as string) ?? '',
    note: (node.note as string | undefined) ?? undefined,
    hasAccessNeedGroup: (node.hasAccessNeedGroup as string | undefined) ?? undefined,
    reciprocalRegistration: (node.reciprocalRegistration as string | undefined) ?? undefined,
  }
}

/**
 * Data grant body from its graph — framed via the data-model's own
 * `Grant.fromJsonLd`, producing the same `GrantData` POJO as
 * `factory.dataGrant`. Grants are immutable, so a present graph is current.
 */
export async function getDataGrant(sparqlEndpoint: string, iri: string): Promise<GrantData> {
  const doc = await graphDoc(sparqlEndpoint, iri)
  return Grant.fromJsonLd(doc, iri)
}