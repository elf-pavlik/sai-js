import { frameNode, selectNode } from '@janeirodigital/interop-utils'
import type { AccessNeedData } from './access-need'
import { dataModelContext } from './context'

export type AccessNeedGroupId = {
  id: string
  type: string[]
}

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
const ACCESS_NEED_GROUP_TERMS = ['hasAccessNeed'] as const

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
    hasAccessNeed: (node.hasAccessNeed as string[] | undefined) ?? [],
    accessNeeds: [],
  }
}
