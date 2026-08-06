import type { WhatwgFetch } from '@janeirodigital/interop-utils'
import { fetchJsonLd, frameDoc, framedValue } from './jsonld-utils'

const accessDescriptionContext = {
  id: '@id',
  type: '@type',
  label: { '@id': 'http://www.w3.org/2004/02/skos/core#prefLabel' },
  definition: { '@id': 'http://www.w3.org/2004/02/skos/core#definition' },
  hasAccessNeed: { '@id': 'http://www.w3.org/ns/solid/interop#hasAccessNeed' },
  hasAccessNeedGroup: {
    '@id': 'http://www.w3.org/ns/solid/interop#hasAccessNeedGroup',
  },
}

// ──────────────────────────
// Types
// ──────────────────────────

/** Plain JSON representation of an access description (need or group). */
export type AccessDescriptionData = {
  id: string
  /** rdf:type IRIs — captured from framing on read */
  type: string[]
  // TODO handle missing labels
  label: string
  definition?: string
}

/** Plain JSON representation of an access need description. */
export type AccessNeedDescriptionData = AccessDescriptionData & {
  // TODO handle missing value
  hasAccessNeed: string
}

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
  const node = (await frameDoc(doc, accessDescriptionContext, iri)) as any
  return {
    id: node.id ?? node['@id'],
    type: node.type ? (Array.isArray(node.type) ? node.type : [node.type]) : [],
    label: framedValue(node.label)!,
    definition: framedValue(node.definition),
    hasAccessNeed: framedValue(node.hasAccessNeed)!,
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
  const node = (await frameDoc(doc, accessDescriptionContext, iri)) as any
  return {
    id: node.id ?? node['@id'],
    type: node.type ? (Array.isArray(node.type) ? node.type : [node.type]) : [],
    label: framedValue(node.label)!,
    definition: framedValue(node.definition),
    hasAccessNeedGroup: framedValue(node.hasAccessNeedGroup)!,
  }
}

export async function loadAccessNeedGroupDescription(
  iri: string,
  fetch: WhatwgFetch
): Promise<AccessNeedGroupDescriptionData> {
  return accessNeedGroupDescriptionFromJsonLd(await fetchJsonLd(iri, fetch), iri)
}
