import { type WhatwgFetch, fetchJsonLd, frameDoc, framedValue } from '@janeirodigital/interop-utils'
import { dataModelContext } from './context'
import type { AccessDescriptionData, AccessDescriptionId } from './access-description'

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
  const node = (await frameDoc(doc, dataModelContext, id)) as any
  return {
    id: node.id ?? node['@id'],
    type: node.type ? (Array.isArray(node.type) ? node.type : [node.type]) : [],
    label: framedValue(node.label)!,
    definition: framedValue(node.definition),
    hasAccessNeedGroup: node.hasAccessNeedGroup!,
  }
}

export async function loadAccessNeedGroupDescription(
  id: string,
  fetch: WhatwgFetch
): Promise<AccessNeedGroupDescriptionData> {
  return fromJsonLd(await fetchJsonLd(id, fetch), id)
}