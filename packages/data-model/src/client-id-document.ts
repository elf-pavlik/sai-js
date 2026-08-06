import type { WhatwgFetch } from '@janeirodigital/interop-utils'
import { fetchJsonLd, frameDoc, framedValue } from './jsonld-utils'

const clientIdDocumentContext = {
  id: '@id',
  type: '@type',
  callbackEndpoint: {
    '@id': 'http://www.w3.org/ns/solid/interop#hasAuthorizationCallbackEndpoint',
  },
  hasAccessNeedGroup: {
    '@id': 'http://www.w3.org/ns/solid/interop#hasAccessNeedGroup',
  },
  clientName: { '@id': 'http://www.w3.org/ns/solid/oidc#client_name' },
  logoUri: { '@id': 'http://www.w3.org/ns/solid/oidc#logo_uri' },
}

// ──────────────────────────
// Types
// ──────────────────────────

/** Plain JSON representation of a Solid OIDC client id document. */
export type ClientIdDocumentData = {
  id: string
  /** rdf:type IRIs — captured from framing on read */
  type: string[]
  callbackEndpoint?: string
  hasAccessNeedGroup?: string
  clientName?: string
  logoUri?: string
}

// ──────────────────────────
// Read path: JSON-LD → ClientIdDocumentData
// ──────────────────────────

/**
 * Convert a JSON-LD document (fetched as application/ld+json) directly into a
 * ClientIdDocumentData POJO. The document can be in expanded, compacted, or
 * flattened form. Remote contexts (e.g. the Solid OIDC context) are resolved
 * from bundled local copies, never fetched over the network.
 */
export async function fromJsonLd(doc: unknown, iri: string): Promise<ClientIdDocumentData> {
  const node = (await frameDoc(doc, clientIdDocumentContext, iri)) as any
  return {
    id: node.id ?? node['@id'],
    type: node.type ? (Array.isArray(node.type) ? node.type : [node.type]) : [],
    callbackEndpoint: framedValue(node.callbackEndpoint),
    hasAccessNeedGroup: framedValue(node.hasAccessNeedGroup),
    clientName: framedValue(node.clientName),
    logoUri: framedValue(node.logoUri),
  }
}

export async function loadClientIdDocument(
  iri: string,
  fetch: WhatwgFetch
): Promise<ClientIdDocumentData> {
  return fromJsonLd(await fetchJsonLd(iri, fetch), iri)
}
