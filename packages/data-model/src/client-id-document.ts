import { INTEROP, frameNode, loader, opt } from '@janeirodigital/interop-utils'
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
  callbackEndpoint: { '@id': INTEROP.hasAuthorizationCallbackEndpoint },
  hasAccessNeedGroup: { '@id': INTEROP.hasAccessNeedGroup },
}

/**
 * Convert a JSON-LD document (fetched as application/ld+json) directly into a
 * ClientIdDocumentData POJO. The document can be in expanded, compacted, or
 * flattened form. Remote contexts (e.g. the Solid OIDC context) are resolved
 * from bundled local copies, never fetched over the network.
 */
export async function fromJsonLd(doc: unknown, id: string): Promise<ClientIdDocumentData> {
  const node = await frameNode(doc, clientIdContext, id)
  return {
    id: node.id ?? node['@id'],
    type: node.type ?? [],
    callbackEndpoint: opt(node, 'callbackEndpoint'),
    hasAccessNeedGroup: opt(node, 'hasAccessNeedGroup'),
    // literals — opt unwraps language-tagged / typed values
    clientName: opt(node, 'clientName'),
    logoUri: opt(node, 'logoUri'),
  }
}

export const loadClientIdDocument = loader(fromJsonLd)
