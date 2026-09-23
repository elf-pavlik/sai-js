import { frameNode, opt, str, strs } from '@janeirodigital/interop-utils'
import type { AccessDescriptionData, AccessDescriptionId } from './access-description'
import { dataModelContext } from './context'

/** Identity of an access need description. */
export type AccessNeedDescriptionId = AccessDescriptionId

/** Plain JSON representation of an access need description. */
export type AccessNeedDescriptionData = AccessDescriptionData & {
  // TODO handle missing value
  hasAccessNeed: string
}

// ──────────────────────────
// Read path: JSON-LD → AccessNeedDescriptionData
// ──────────────────────────

/**
 * Convert a JSON-LD document (fetched as application/ld+json) directly into an
 * AccessNeedDescriptionData POJO. The document can be in expanded, compacted,
 * or flattened form.
 */
export async function fromJsonLd(doc: unknown, id: string): Promise<AccessNeedDescriptionData> {
  const node = await frameNode(doc, dataModelContext, id)
  return {
    id: node.id ?? node['@id'],
    type: node.type ?? [],
    label: str(node, 'label'),
    definition: opt(node, 'definition'),
    // `hasAccessNeed` is @set in the shared context — the single member
    hasAccessNeed: strs(node, 'hasAccessNeed')[0] ?? '',
  }
}
