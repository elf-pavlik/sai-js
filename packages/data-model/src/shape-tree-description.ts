import type { DatasetCore } from '@rdfjs/types'
import { Store } from 'n3'
import { frameDataset, frameDoc, framedValue, toStore, withContext } from './jsonld-utils'

const shapeTreeDescriptionContext = {
  id: '@id',
  type: '@type',
  label: { '@id': 'http://www.w3.org/2004/02/skos/core#prefLabel' },
  definition: { '@id': 'http://www.w3.org/2004/02/skos/core#definition' },
}

// ──────────────────────────
// Types
// ──────────────────────────

/** Plain JSON representation of a shape tree description resource. */
export type ShapeTreeDescriptionData = {
  id: string
  // TODO: handle missing labels
  label: string
  definition?: string
}

// ──────────────────────────
// Read path: Dataset / JSON-LD → ShapeTreeDescriptionData
// ──────────────────────────

/**
 * Convert a parsed RDF dataset into a ShapeTreeDescriptionData POJO.
 * Uses jsonld.frame with the shapeTreeDescriptionContext.
 */
export async function fromDataset(
  dataset: DatasetCore,
  iri: string
): Promise<ShapeTreeDescriptionData> {
  return compactNodeToShapeTreeDescriptionData(
    (await frameDataset(dataset, shapeTreeDescriptionContext, iri)) as any
  )
}

/**
 * Convert a JSON-LD document (fetched as application/ld+json) directly into a
 * ShapeTreeDescriptionData POJO. The document can be in expanded, compacted,
 * or flattened form.
 */
export async function fromJsonLd(doc: unknown, iri: string): Promise<ShapeTreeDescriptionData> {
  return compactNodeToShapeTreeDescriptionData(
    (await frameDoc(doc, shapeTreeDescriptionContext, iri)) as any
  )
}

function compactNodeToShapeTreeDescriptionData(node: any): ShapeTreeDescriptionData {
  return {
    id: node.id ?? node['@id'],
    label: framedValue(node.label)!,
    definition: framedValue(node.definition),
  }
}

// ──────────────────────────
// Write path: ShapeTreeDescriptionData → Dataset / JSON-LD
// ──────────────────────────

/** Convert a ShapeTreeDescriptionData to an N3 Store (DatasetCore). */
export async function toDataset(data: ShapeTreeDescriptionData): Promise<Store> {
  return toStore(toJsonLd(data), data.id)
}

/** Build a JSON-LD document (with embedded context) ready for PUT as application/ld+json. */
export function toJsonLd(data: ShapeTreeDescriptionData): Record<string, unknown> {
  return withContext(shapeTreeDescriptionContext, data)
}
