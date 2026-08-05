import type { DatasetCore } from '@rdfjs/types'
import { Store } from 'n3'
import { frameDataset, frameDoc, toStore, withContext } from './jsonld-utils'

const dataRegistrationContext = {
  id: '@id',
  type: '@type',
  registeredShapeTree: {
    '@id': 'http://www.w3.org/ns/solid/interop#registeredShapeTree',
    '@type': '@id',
  },
  contains: {
    '@id': 'http://www.w3.org/ns/ldp#contains',
    '@type': '@id',
    '@container': '@set',
  },
}

// ──────────────────────────
// Types
// ──────────────────────────

/** Plain JSON representation of a Data Registration. */
export type DataRegistrationData = {
  id: string
  registeredShapeTree: string
  /** Resources contained in the registration (LDP containment, server-managed). */
  contains: string[]
}

// ──────────────────────────
// Read path: Dataset / JSON-LD → DataRegistrationData
// ──────────────────────────

/**
 * Convert a parsed RDF dataset into a DataRegistrationData POJO.
 * Uses jsonld.frame with the dataRegistrationContext.
 */
export async function fromDataset(
  dataset: DatasetCore,
  iri: string
): Promise<DataRegistrationData> {
  return compactNodeToDataRegistrationData(
    (await frameDataset(dataset, dataRegistrationContext, iri)) as any
  )
}

/**
 * Convert a JSON-LD document (fetched as application/ld+json) directly into a
 * DataRegistrationData POJO. The document can be in expanded, compacted, or
 * flattened form.
 */
export async function fromJsonLd(doc: unknown, iri: string): Promise<DataRegistrationData> {
  return compactNodeToDataRegistrationData((await frameDoc(doc, dataRegistrationContext, iri)) as any)
}

function compactNodeToDataRegistrationData(node: any): DataRegistrationData {
  return {
    id: node.id ?? node['@id'],
    registeredShapeTree: node.registeredShapeTree,
    contains: node.contains ?? [],
  }
}

// ──────────────────────────
// Write path: DataRegistrationData → Dataset / JSON-LD
// ──────────────────────────

/** Convert a DataRegistrationData to an N3 Store (DatasetCore). */
export async function toDataset(data: DataRegistrationData): Promise<Store> {
  return toStore(toJsonLd(data), data.id)
}

/** Build a JSON-LD document (with embedded context) ready for PUT as application/ld+json. */
export function toJsonLd(data: DataRegistrationData): Record<string, unknown> {
  return withContext(dataRegistrationContext, data)
}
