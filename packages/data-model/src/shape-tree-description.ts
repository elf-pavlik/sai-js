import { frameNode, loader, opt, str } from '@janeirodigital/interop-utils'
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
export async function fromJsonLd(doc: unknown, id: string): Promise<ShapeTreeDescriptionData> {
  const node = await frameNode(doc, dataModelContext, id)
  return {
    id: node.id ?? node['@id'],
    type: node.type ?? [],
    label: str(node, 'label'),
    definition: opt(node, 'definition'),
  }
}

export const loadShapeTreeDescription = loader(fromJsonLd)
