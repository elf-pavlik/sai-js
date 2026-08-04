import type { DatasetCore } from '@rdfjs/types'
import { Store } from 'n3'
import { frameDataset, frameDoc, framedValue, toStore, withContext } from './jsonld-utils'

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
  callbackEndpoint?: string
  hasAccessNeedGroup?: string
  clientName?: string
  logoUri?: string
}

// ──────────────────────────
// Read path: Dataset / JSON-LD → ClientIdDocumentData
// ──────────────────────────

/**
 * Convert a parsed RDF dataset into a ClientIdDocumentData POJO.
 * Uses jsonld.frame with the clientIdDocumentContext.
 */
export async function fromDataset(dataset: DatasetCore, iri: string): Promise<ClientIdDocumentData> {
  return compactNodeToClientIdDocumentData(
    (await frameDataset(dataset, clientIdDocumentContext, iri)) as any
  )
}

/**
 * Convert a JSON-LD document (fetched as application/ld+json) directly into a
 * ClientIdDocumentData POJO. The document can be in expanded, compacted, or
 * flattened form. Remote contexts (e.g. the Solid OIDC context) are resolved
 * from bundled local copies, never fetched over the network.
 */
export async function fromJsonLd(doc: unknown, iri: string): Promise<ClientIdDocumentData> {
  return compactNodeToClientIdDocumentData(
    (await frameDoc(doc, clientIdDocumentContext, iri)) as any
  )
}

function compactNodeToClientIdDocumentData(node: any): ClientIdDocumentData {
  return {
    id: node.id ?? node['@id'],
    callbackEndpoint: framedValue(node.callbackEndpoint),
    hasAccessNeedGroup: framedValue(node.hasAccessNeedGroup),
    clientName: framedValue(node.clientName),
    logoUri: framedValue(node.logoUri),
  }
}

// ──────────────────────────
// Write path: ClientIdDocumentData → Dataset / JSON-LD
// ──────────────────────────

/** Convert a ClientIdDocumentData to an N3 Store (DatasetCore). */
export async function toDataset(data: ClientIdDocumentData): Promise<Store> {
  return toStore(toJsonLd(data), data.id)
}

/** Build a JSON-LD document (with embedded context) ready for PUT as application/ld+json. */
export function toJsonLd(data: ClientIdDocumentData): Record<string, unknown> {
  return withContext(clientIdDocumentContext, data)
}
