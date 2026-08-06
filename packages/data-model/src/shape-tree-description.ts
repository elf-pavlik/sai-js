import type { WhatwgFetch } from '@janeirodigital/interop-utils'
import { fetchJsonLd, frameDoc, framedValue } from './jsonld-utils'

const shapeTreeDescriptionContext = {
  id: '@id',
  type: '@type',
  label: { '@id': 'http://www.w3.org/2004/02/skos/core#prefLabel' },
  definition: { '@id': 'http://www.w3.org/2004/02/skos/core#definition' },
}

// ──────────────────────────
// Types
// ──────────────────────────

/** Plain JSON representation of a shape tree description resource. */
export type ShapeTreeDescriptionData = {
  id: string
  /** rdf:type IRIs — captured from framing on read */
  type: string[]
  // TODO: handle missing labels
  label: string
  definition?: string
}

// ──────────────────────────
// Read path: JSON-LD → ShapeTreeDescriptionData
// ──────────────────────────

/**
 * Convert a JSON-LD document (fetched as application/ld+json) directly into a
 * ShapeTreeDescriptionData POJO. The document can be in expanded, compacted,
 * or flattened form.
 */
export async function fromJsonLd(doc: unknown, iri: string): Promise<ShapeTreeDescriptionData> {
  const node = (await frameDoc(doc, shapeTreeDescriptionContext, iri)) as any
  return {
    id: node.id ?? node['@id'],
    type: node.type ? (Array.isArray(node.type) ? node.type : [node.type]) : [],
    label: framedValue(node.label)!,
    definition: framedValue(node.definition),
  }
}

export async function loadShapeTreeDescription(
  iri: string,
  fetch: WhatwgFetch
): Promise<ShapeTreeDescriptionData> {
  return fromJsonLd(await fetchJsonLd(iri, fetch), iri)
}
