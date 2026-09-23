import { frameNode, str, strs } from '@janeirodigital/interop-utils'
import { dataModelContext } from './context'

// ──────────────────────────
// Types
// ──────────────────────────

export type RoleId = {
  id: string
  /** rdf:type IRIs — captured from framing on read, written via compaction on write */
  type: string[]
}

export type RoleData = RoleId & {
  label: string
  members: string[]
}

// ──────────────────────────
// Read path: JSON-LD → RoleData
// ──────────────────────────

/**
 * Convert a JSON-LD document (fetched as application/ld+json) directly into a RoleData POJO.
 *
 * The document can be in expanded, compacted, or flattened form.
 * Uses jsonld.frame with the shared data model context: `members` is coerced
 * to a string array via @type: @id + @container: @set, `label` to a plain
 * string, and the rdf:type (from framing) to a string array.
 */
export async function fromJsonLd(doc: unknown, id: string): Promise<RoleData> {
  const node = await frameNode(doc, dataModelContext, id)
  return {
    id,
    type: node.type ?? [],
    label: str(node, 'label'),
    members: strs(node, 'members'),
  }
}
