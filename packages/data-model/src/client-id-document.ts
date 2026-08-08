import { INTEROP, type WhatwgFetch } from '@janeirodigital/interop-utils'
import { dataModelContext } from './context'
import { fetchJsonLd, frameDoc, framedValue } from './jsonld-utils'

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
  const node = (await frameDoc(doc, dataModelContext, iri)) as any
  return {
    id: node.id ?? node['@id'],
    type: node.type ? (Array.isArray(node.type) ? node.type : [node.type]) : [],
    // Compacted client id documents write IRI values as plain strings (the
    // oidc-context types them as literals), so those frame under the raw IRI
    // key instead of the @type:'@id' term key — check both. Expanded-form
    // documents (node references) compact to the term key directly.
    callbackEndpoint:
      node.callbackEndpoint ??
      node[INTEROP.hasAuthorizationCallbackEndpoint.value] ??
      undefined,
    hasAccessNeedGroup:
      node.hasAccessNeedGroup ?? node[INTEROP.hasAccessNeedGroup.value] ?? undefined,
    // literals — framedValue unwraps language-tagged / typed values
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
