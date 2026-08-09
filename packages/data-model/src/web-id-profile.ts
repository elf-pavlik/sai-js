import { type WhatwgFetch, fetchJsonLd, frameDoc, framedValue } from '@janeirodigital/interop-utils'
import { dataModelContext } from './context'

// ──────────────────────────
// Types
// ──────────────────────────

/** Plain JSON representation of a WebID profile document. */
export type WebIdProfileData = {
  id: string
  /** rdf:type IRIs — captured from framing on read */
  type: string[]
  label?: string
  oidcIssuer?: string
}

// ──────────────────────────
// Read path: JSON-LD → WebIdProfileData
// ──────────────────────────

/**
 * Convert a JSON-LD document (fetched as application/ld+json) directly into a
 * WebIdProfileData POJO. The document can be in expanded, compacted, or
 * flattened form.
 */
export async function fromJsonLd(doc: unknown, iri: string): Promise<WebIdProfileData> {
  const node = (await frameDoc(doc, dataModelContext, iri)) as any
  return {
    id: node.id ?? node['@id'],
    type: node.type ? (Array.isArray(node.type) ? node.type : [node.type]) : [],
    // rdfs:label — literal
    label: framedValue(node.label),
    // node reference — @type: '@id' coerced
    oidcIssuer: node.oidcIssuer ?? undefined,
  }
}

export async function loadWebIdProfile(iri: string, fetch: WhatwgFetch): Promise<WebIdProfileData> {
  return fromJsonLd(await fetchJsonLd(iri, fetch), iri)
}
