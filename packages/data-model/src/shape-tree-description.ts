import { type WhatwgFetch, fetchJsonLd, frameDoc, framedValue } from '@janeirodigital/interop-utils'
import { dataModelContext } from './context'

// ──────────────────────────
// Types
// ──────────────────────────

/** Identity of a shape tree description resource. */
export type ShapeTreeDescriptionId = {
  id: string
  /** rdf:type IRIs — captured from framing on read */
  type: string[]
}

/** Plain JSON representation of a shape tree description resource. */
export type ShapeTreeDescriptionData = ShapeTreeDescriptionId & {
  // TODO: handle missing labels
  prefLabel: string
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
export async function fromJsonLd(doc: unknown, id: string): Promise<ShapeTreeDescriptionData> {
  const node = (await frameDoc(doc, dataModelContext, id)) as any
  return {
    id: node.id ?? node['@id'],
    type: node.type ? (Array.isArray(node.type) ? node.type : [node.type]) : [],
    prefLabel: framedValue(node.prefLabel)!,
    definition: framedValue(node.definition),
  }
}

export async function loadShapeTreeDescription(
  id: string,
  fetch: WhatwgFetch
): Promise<ShapeTreeDescriptionData> {
  return fromJsonLd(await fetchJsonLd(id, fetch), id)
}
