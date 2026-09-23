import { frameNode, strs } from '@janeirodigital/interop-utils'
import type { AccessNeedData } from './access-need'
import { dataModelContext } from './context'

// ──────────────────────────
// Types
// ──────────────────────────

/** Identity of an access need group. */
export type AccessNeedGroupId = {
  id: string
  /** rdf:type IRIs — captured from framing on read */
  type: string[]
}

/** Plain JSON representation of an access need group. */
export type AccessNeedGroupData = AccessNeedGroupId & {
  hasAccessNeed: string[]
  /** The group's access needs, loaded recursively (see the AA `accessNeedGroup` composed read). */
  accessNeeds: AccessNeedData[]
}

// ──────────────────────────
// Read path: JSON-LD → AccessNeedGroupData
// ──────────────────────────

/**
 * Convert a JSON-LD document (fetched as application/ld+json) directly into an
 * AccessNeedGroupData POJO. The document can be in expanded, compacted, or
 * flattened form.
 */
export async function fromJsonLd(doc: unknown, id: string): Promise<AccessNeedGroupData> {
  const node = await frameNode(doc, dataModelContext, id)
  return {
    id: node.id ?? node['@id'],
    type: node.type ?? [],
    hasAccessNeed: strs(node, 'hasAccessNeed'),
    accessNeeds: [],
  }
}
