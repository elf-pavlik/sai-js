import { frameNode, opt } from '@janeirodigital/interop-utils'
import type { AccessDescriptionData, AccessDescriptionId } from './access-description'
import { dataModelContext } from './context'

export type AccessNeedGroupDescriptionId = AccessDescriptionId

export type AccessNeedGroupDescriptionData = AccessDescriptionData & {
  // TODO handle missing value
  hasAccessNeedGroup: string
}

// ──────────────────────────
// Read path: JSON-LD → AccessNeedGroupDescriptionData
// ──────────────────────────

/**
 * Convert a JSON-LD document (fetched as application/ld+json) directly into an
 * AccessNeedGroupDescriptionData POJO. The document can be in expanded,
 * compacted, or flattened form.
 */
const ACCESS_NEED_GROUP_DESCRIPTION_TERMS = ['label', 'definition', 'hasAccessNeedGroup'] as const

export async function fromJsonLd(
  doc: unknown,
  id: string
): Promise<AccessNeedGroupDescriptionData> {
  const node = await frameNode(doc, dataModelContext, id)
  return {
    id: node.id ?? node['@id'],
    type: node.type ?? [],
    label: opt(node, 'label'),
    definition: opt(node, 'definition'),
    hasAccessNeedGroup: node.hasAccessNeedGroup as string,
  }
}
