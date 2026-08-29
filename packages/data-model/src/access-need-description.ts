import { type WhatwgFetch, fetchJsonLd, frameDoc, framedValue } from '@janeirodigital/interop-utils'
import { dataModelContext } from './context'
import type { AccessDescriptionData, AccessDescriptionId } from './access-description'

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
  const node = (await frameDoc(doc, dataModelContext, id)) as any
  return {
    id: node.id ?? node['@id'],
    type: node.type ? (Array.isArray(node.type) ? node.type : [node.type]) : [],
    prefLabel: framedValue(node.prefLabel)!,
    definition: framedValue(node.definition),
    // `hasAccessNeed` is @set in the shared context — unwrap the single value
    hasAccessNeed: (node.hasAccessNeed ?? [])[0]!,
  }
}

export async function loadAccessNeedDescription(
  id: string,
  fetch: WhatwgFetch
): Promise<AccessNeedDescriptionData> {
  return fromJsonLd(await fetchJsonLd(id, fetch), id)
}