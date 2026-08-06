import type { WhatwgFetch } from '@janeirodigital/interop-utils'
import { fetchJsonLd, frameDoc, framedValue } from './jsonld-utils'

const webIdProfileContext = {
  id: '@id',
  type: '@type',
  label: { '@id': 'http://www.w3.org/2000/01/rdf-schema#label' },
  oidcIssuer: { '@id': 'http://www.w3.org/ns/solid/terms#oidcIssuer' },
}

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
  const node = (await frameDoc(doc, webIdProfileContext, iri)) as any
  return {
    id: node.id ?? node['@id'],
    type: node.type ? (Array.isArray(node.type) ? node.type : [node.type]) : [],
    label: framedValue(node.label),
    oidcIssuer: framedValue(node.oidcIssuer),
  }
}

export async function loadWebIdProfile(
  iri: string,
  fetch: WhatwgFetch
): Promise<WebIdProfileData> {
  return fromJsonLd(await fetchJsonLd(iri, fetch), iri)
}
