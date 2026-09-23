import { INTEROP, OIDC, frameNode, selectNode } from '@janeirodigital/interop-utils'
import { dataModelContext } from './context'

// ──────────────────────────
// Types
// ──────────────────────────

/** Identity of a Solid OIDC client id document. */
export type ClientIdDocumentId = {
  id: string
  /** rdf:type IRIs — captured from framing on read */
  type: string[]
}

/** Plain JSON representation of a Solid OIDC client id document. */
export type ClientIdDocumentData = ClientIdDocumentId & {
  callbackEndpoint?: string
  hasAccessNeedGroup?: string
  clientName?: string
  logoUri?: string
}

// ──────────────────────────
// Read path: JSON-LD → ClientIdDocumentData
// ──────────────────────────

/** Per-model context for client id documents: the two interop terms drop the
 * `@type: '@id'` coercion. A client id document's OWN context (the Solid OIDC
 * context) types the same values as plain strings, and under coercion a
 * literal compacts to the RAW IRI key instead of the term key (docs/jsonld.md
 * TODO 5). Without coercion, node references, literal strings and
 * `{ '@value' }` literals ALL compact to the term key, and `opt` unwraps
 * every form. */
const clientIdContext: JsonLdContext = {
  ...dataModelContext,
  // these values are IRIs semantically (like client_id) — coerce so node
  // refs compact to plain strings; a literal on the wire must be fixed at
  // the document (the dagger env client-id now writes node refs)
  callbackEndpoint: {
    '@id': INTEROP.hasAuthorizationCallbackEndpoint,
    '@type': '@id',
  },
  hasAccessNeedGroup: { '@id': INTEROP.hasAccessNeedGroup, '@type': '@id' },
  logoUri: { '@id': OIDC.logo_uri, '@type': '@id' },
}

/**
 * Convert a JSON-LD document (fetched as application/ld+json) directly into a
 * ClientIdDocumentData POJO. The document can be in expanded, compacted, or
 * flattened form. Remote contexts (e.g. the Solid OIDC context) are resolved
 * from bundled local copies, never fetched over the network.
 */
const CLIENT_ID_DOCUMENT_TERMS = [
  'callbackEndpoint',
  'hasAccessNeedGroup',
  'clientName',
  'logoUri',
] as const

/**
 * Convert a JSON-LD document (fetched as application/ld+json) directly into a
 * ClientIdDocumentData POJO. The document can be in expanded, compacted, or
 * flattened form. Remote contexts (e.g. the Solid OIDC context) are resolved
 * from bundled local copies, never fetched over the network.
 */
export async function fromJsonLd(doc: unknown, id: string): Promise<ClientIdDocumentData> {
  return selectNode(
    await frameNode(doc, clientIdContext, id),
    CLIENT_ID_DOCUMENT_TERMS
  ) as unknown as ClientIdDocumentData
}
