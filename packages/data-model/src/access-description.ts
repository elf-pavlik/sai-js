import { type WhatwgFetch, fetchJsonLd, frameDoc, framedValue } from '@janeirodigital/interop-utils'
import { dataModelContext } from './context'

// ──────────────────────────
// Types
// ──────────────────────────

/** Identity of an access description. */
export type AccessDescriptionId = {
  id: string
  /** rdf:type IRIs — captured from framing on read */
  type: string[]
}

/** Plain JSON representation of an access description (need or group). */
export type AccessDescriptionData = AccessDescriptionId & {
  // TODO handle missing labels
  prefLabel: string
  definition?: string
}

/** Identity of an access need description. */
export type AccessNeedDescriptionId = AccessDescriptionId

/** Plain JSON representation of an access need description. */
export type AccessNeedDescriptionData = AccessDescriptionData & {
  // TODO handle missing value
  hasAccessNeed: string
}

/** Identity of an access need group description. */
export type AccessNeedGroupDescriptionId = AccessDescriptionId

/** Plain JSON representation of an access need group description. */
export type AccessNeedGroupDescriptionData = AccessDescriptionData & {
  // TODO handle missing value
  hasAccessNeedGroup: string
}

// ──────────────────────────
// Read path: JSON-LD → AccessNeedDescriptionData
// ──────────────────────────

/**
 * Convert a JSON-LD document (fetched as application/ld+json) directly into an
 * AccessNeedDescriptionData POJO. The document can be in expanded, compacted,
 * or flattened form.
 */
export async function accessNeedDescriptionFromJsonLd(
  doc: unknown,
  iri: string
): Promise<AccessNeedDescriptionData> {
  const node = (await frameDoc(doc, dataModelContext, iri)) as any
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
  iri: string,
  fetch: WhatwgFetch
): Promise<AccessNeedDescriptionData> {
  return accessNeedDescriptionFromJsonLd(await fetchJsonLd(iri, fetch), iri)
}

// ──────────────────────────
// Read path: JSON-LD → AccessNeedGroupDescriptionData
// ──────────────────────────

/**
 * Convert a JSON-LD document (fetched as application/ld+json) directly into an
 * AccessNeedGroupDescriptionData POJO. The document can be in expanded,
 * compacted, or flattened form.
 */
export async function accessNeedGroupDescriptionFromJsonLd(
  doc: unknown,
  iri: string
): Promise<AccessNeedGroupDescriptionData> {
  const node = (await frameDoc(doc, dataModelContext, iri)) as any
  return {
    id: node.id ?? node['@id'],
    type: node.type ? (Array.isArray(node.type) ? node.type : [node.type]) : [],
    prefLabel: framedValue(node.prefLabel)!,
    definition: framedValue(node.definition),
    hasAccessNeedGroup: node.hasAccessNeedGroup!,
  }
}

export async function loadAccessNeedGroupDescription(
  iri: string,
  fetch: WhatwgFetch
): Promise<AccessNeedGroupDescriptionData> {
  return accessNeedGroupDescriptionFromJsonLd(await fetchJsonLd(iri, fetch), iri)
}
