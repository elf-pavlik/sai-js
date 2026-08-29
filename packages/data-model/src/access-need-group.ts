import { type WhatwgFetch, fetchJsonLd, frameDoc } from '@janeirodigital/interop-utils'
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
  const node = (await frameDoc(doc, dataModelContext, id)) as any
  return {
    id: node.id ?? node['@id'],
    type: node.type ? (Array.isArray(node.type) ? node.type : [node.type]) : [],
    hasAccessNeed: node.hasAccessNeed ?? [],
    accessNeeds: [],
  }
}

export async function loadAccessNeedGroup(
  id: string,
  fetch: WhatwgFetch
): Promise<AccessNeedGroupData> {
  return fromJsonLd(await fetchJsonLd(id, fetch), id)
}
