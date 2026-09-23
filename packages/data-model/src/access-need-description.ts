import { type LanguageMap, frameNode } from '@janeirodigital/interop-utils'
import type { AccessDescriptionData, AccessDescriptionId } from './access-description'
import { accessDescriptionContext } from './access-description'

export type AccessNeedDescriptionId = AccessDescriptionId

export type AccessNeedDescriptionData = AccessDescriptionData & {
  hasAccessNeed?: string
}

// ──────────────────────────
// Read path: JSON-LD → AccessNeedDescriptionData
// ──────────────────────────

const ACCESS_NEED_DESCRIPTION_TERMS = ['label', 'definition', 'hasAccessNeed']

/**
 * Convert a JSON-LD document (fetched as application/ld+json) directly into an
 * AccessNeedDescriptionData POJO. The document can be in expanded, compacted,
 * or flattened form.
 */
export async function fromJsonLd(doc: unknown, id: string): Promise<AccessNeedDescriptionData> {
  const node = await frameNode(doc, accessDescriptionContext, id)
  return {
    id: node.id ?? node['@id'],
    type: node.type ?? [],
    label: node.label as LanguageMap,
    definition: node.definition as LanguageMap | undefined,
    hasAccessNeed: (node.hasAccessNeed as string[] | undefined)?.[0],
  }
}
