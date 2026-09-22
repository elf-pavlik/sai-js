import { frameNode, loader, opt, str } from '@janeirodigital/interop-utils'
import type { AccessDescriptionData, AccessDescriptionId } from './access-description'
import { dataModelContext } from './context'

/** Identity of an access need group description. */
export type AccessNeedGroupDescriptionId = AccessDescriptionId

/** Plain JSON representation of an access need group description. */
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
export async function fromJsonLd(
  doc: unknown,
  id: string
): Promise<AccessNeedGroupDescriptionData> {
  const node = await frameNode(doc, dataModelContext, id)
  return {
    id: node.id ?? node['@id'],
    type: node.type ?? [],
    label: str(node, 'label'),
    definition: opt(node, 'definition'),
    hasAccessNeedGroup: str(node, 'hasAccessNeedGroup'),
  }
}

export const loadAccessNeedGroupDescription = loader(fromJsonLd)
