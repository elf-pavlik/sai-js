import type { DatasetCore } from '@rdfjs/types'
import { Store } from 'n3'
import { frameDataset, frameDoc, framedValue, toStore, withContext } from './jsonld-utils'

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
// Read path: Dataset / JSON-LD → AccessNeedDescriptionData
// ──────────────────────────

/**
 * Convert a parsed RDF dataset into an AccessNeedDescriptionData POJO.
 * Uses jsonld.frame with the accessDescriptionContext.
 */
export async function accessNeedDescriptionFromDataset(
  dataset: DatasetCore,
  iri: string
): Promise<AccessNeedDescriptionData> {
  const node = (await frameDataset(dataset, accessDescriptionContext, iri)) as any
  return {
    ...compactNodeToAccessDescriptionData(node),
    hasAccessNeed: framedValue(node.hasAccessNeed)!,
  }
}

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
    ...compactNodeToAccessDescriptionData(node),
    hasAccessNeed: framedValue(node.hasAccessNeed)!,
  }
}

// ──────────────────────────
// Read path: Dataset / JSON-LD → AccessNeedGroupDescriptionData
// ──────────────────────────

/**
 * Convert a parsed RDF dataset into an AccessNeedGroupDescriptionData POJO.
 * Uses jsonld.frame with the accessDescriptionContext.
 */
export async function accessNeedGroupDescriptionFromDataset(
  dataset: DatasetCore,
  iri: string
): Promise<AccessNeedGroupDescriptionData> {
  const node = (await frameDataset(dataset, accessDescriptionContext, iri)) as any
  return {
    ...compactNodeToAccessDescriptionData(node),
    hasAccessNeedGroup: framedValue(node.hasAccessNeedGroup)!,
  }
}

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
    ...compactNodeToAccessDescriptionData(node),
    hasAccessNeedGroup: framedValue(node.hasAccessNeedGroup)!,
  }
}

function compactNodeToAccessDescriptionData(node: any): AccessDescriptionData {
  return {
    id: node.id ?? node['@id'],
    label: framedValue(node.label)!,
    definition: framedValue(node.definition),
  }
}

// ──────────────────────────
// Write path: AccessNeedDescriptionData → Dataset / JSON-LD
// ──────────────────────────

/** Convert an AccessNeedDescriptionData to an N3 Store (DatasetCore). */
export async function accessNeedDescriptionToDataset(
  data: AccessNeedDescriptionData
): Promise<Store> {
  return toStore(accessNeedDescriptionToJsonLd(data), data.id)
}

/** Build a JSON-LD document (with embedded context) ready for PUT as application/ld+json. */
export function accessNeedDescriptionToJsonLd(
  data: AccessNeedDescriptionData
): Record<string, unknown> {
  return withContext(accessDescriptionContext, data)
}

// ──────────────────────────
// Write path: AccessNeedGroupDescriptionData → Dataset / JSON-LD
// ──────────────────────────

/** Convert an AccessNeedGroupDescriptionData to an N3 Store (DatasetCore). */
export async function accessNeedGroupDescriptionToDataset(
  data: AccessNeedGroupDescriptionData
): Promise<Store> {
  return toStore(accessNeedGroupDescriptionToJsonLd(data), data.id)
}

/** Build a JSON-LD document (with embedded context) ready for PUT as application/ld+json. */
export function accessNeedGroupDescriptionToJsonLd(
  data: AccessNeedGroupDescriptionData
): Record<string, unknown> {
  return withContext(accessDescriptionContext, data)
}
