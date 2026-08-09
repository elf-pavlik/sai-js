import {
  SHAPETREES,
  XSD,
  getAllMatchingQuads,
  getOneMatchingQuad,
  parseJsonld,
  toStore,
  withContext,
} from '@janeirodigital/interop-utils'
import type { DatasetCore, NamedNode } from '@rdfjs/types'
import { DataFactory, type Store } from 'n3'
import type { InteropFactory, ShapeTreeDescriptionData } from '.'
import { dataModelContext } from './context'

export interface ShapeTreeReference {
  shapeTree: string
  viaPredicate: NamedNode
}

// ──────────────────────────
// Types
// ──────────────────────────

/** Plain JSON representation of a shape tree. */
export type ShapeTreeData = {
  id: string
  shape?: string
  describesInstance?: string
  expectsType?: string
  /** Languages used by description sets in the shape tree document. */
  descriptionLanguages: string[]
  references: ShapeTreeReference[]
}

// ──────────────────────────
// Read path: Dataset / JSON-LD → ShapeTreeData
// ──────────────────────────

/**
 * Convert a parsed RDF dataset into a ShapeTreeData POJO.
 *
 * The `references` (blank nodes with `hasShapeTree` / `viaPredicate`) and the
 * `descriptionLanguages` (typed literals on all description sets in the
 * document) are extracted directly from the quads, since framing can't
 * capture either shape.
 */
export async function fromDataset(dataset: DatasetCore, iri: string): Promise<ShapeTreeData> {
  const node = DataFactory.namedNode(iri)
  const referenceNodes = getAllMatchingQuads(dataset, node, SHAPETREES.references).map(
    (quad) => quad.object
  )
  const references: ShapeTreeReference[] = referenceNodes.map((referenceNode) => {
    const hasShapeTree = getOneMatchingQuad(dataset, referenceNode, SHAPETREES.hasShapeTree)
    const viaPredicate = getOneMatchingQuad(dataset, referenceNode, SHAPETREES.viaPredicate)
    if (!hasShapeTree || !viaPredicate) {
      throw new Error(`shape tree ${iri} has a reference missing hasShapeTree/viaPredicate`)
    }
    return {
      shapeTree: hasShapeTree.object.value,
      viaPredicate: viaPredicate.object as NamedNode,
    }
  })
  return {
    id: iri,
    shape: getOneMatchingQuad(dataset, node, SHAPETREES.shape)?.object.value,
    describesInstance: getOneMatchingQuad(dataset, node, SHAPETREES.describesInstance)?.object
      .value,
    expectsType: getOneMatchingQuad(dataset, node, SHAPETREES.expectsType)?.object.value,
    descriptionLanguages: getAllMatchingQuads(dataset, null, SHAPETREES.usesLanguage).map(
      (quad) => quad.object.value
    ),
    references,
  }
}

/**
 * Convert a JSON-LD document (fetched as application/ld+json) directly into a
 * ShapeTreeData POJO. The document can be in expanded, compacted, or flattened
 * form.
 */
export async function fromJsonLd(doc: unknown, iri: string): Promise<ShapeTreeData> {
  const dataset = await parseJsonld(JSON.stringify(doc), iri)
  return fromDataset(dataset, iri)
}

// ──────────────────────────
// Write path: ShapeTreeData → Dataset / JSON-LD
// ──────────────────────────

/** Convert a ShapeTreeData to an N3 Store (DatasetCore). */
export async function toDataset(data: ShapeTreeData): Promise<Store> {
  return toStore(toJsonLd(data), data.id)
}

/** Build a JSON-LD document (with embedded context) ready for PUT as application/ld+json. */
export function toJsonLd(data: ShapeTreeData): Record<string, unknown> {
  return withContext(dataModelContext, {
    ...data,
    references: data.references.map((reference) => ({
      hasShapeTree: reference.shapeTree,
      viaPredicate: reference.viaPredicate.value,
    })),
  })
}

// ──────────────────────────
// Behavior functions (replacing class methods)
// ──────────────────────────

/**
 * Fetch the shape tree description for the given language, or null when the
 * tree has no description set for that language.
 */
export async function getDescription(
  tree: ShapeTreeData,
  lang: string,
  factory: InteropFactory
): Promise<ShapeTreeDescriptionData | null> {
  const response = await factory.fetch(tree.id, {
    headers: { Accept: 'application/ld+json' },
  })
  const doc = await response.json()
  const dataset = await parseJsonld(JSON.stringify(doc), tree.id)
  const descriptionSetNode = getOneMatchingQuad(
    dataset,
    null,
    SHAPETREES.usesLanguage,
    DataFactory.literal(lang, XSD.language)
  )?.subject
  if (!descriptionSetNode) return null
  const descriptionNodes = getAllMatchingQuads(dataset, null, SHAPETREES.describes).map(
    (quad) => quad.subject
  )
  const descriptionIri = descriptionNodes.find((node) =>
    getOneMatchingQuad(dataset, node, SHAPETREES.inDescriptionSet, descriptionSetNode)
  )?.value
  return descriptionIri ? factory.readable.shapeTreeDescription(descriptionIri) : null
}

/** The type of resources the shape tree expects (as a NamedNode). */
export function expectsType(tree: ShapeTreeData): NamedNode {
  if (!tree.expectsType) {
    throw new Error(`shape tree ${tree.id} is missing expectsType`)
  }
  return DataFactory.namedNode(tree.expectsType)
}
