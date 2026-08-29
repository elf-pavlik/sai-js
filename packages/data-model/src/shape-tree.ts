import {
  RDF,
  SHAPETREES,
  type WhatwgFetch,
  XSD,
  getAllMatchingQuads,
  getOneMatchingQuad,
  parseJsonld,
  toStore,
  withContext,
} from '@janeirodigital/interop-utils'
import type { DatasetCore, NamedNode } from '@rdfjs/types'
import { DataFactory, type Store } from 'n3'
import type { ShapeTreeDescriptionData } from '.'
import { dataModelContext } from './context'
import { loadShapeTreeDescription } from './shape-tree-description'

export interface ShapeTreeReference {
  shapeTree: string
  viaPredicate: NamedNode
}

// ──────────────────────────
// Types
// ──────────────────────────

/** Identity of a shape tree. */
export type ShapeTreeId = {
  id: string
  /** rdf:type IRIs — captured from the dataset on read (e.g. `[SHAPETREES.ShapeTree]`) */
  type: string[]
}

/** Plain JSON representation of a shape tree. */
export type ShapeTreeData = ShapeTreeId & {
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
export async function fromDataset(dataset: DatasetCore, id: string): Promise<ShapeTreeData> {
  const node = DataFactory.namedNode(id)
  const referenceNodes = getAllMatchingQuads(dataset, node, SHAPETREES.terms.references).map(
    (quad) => quad.object
  )
  const references: ShapeTreeReference[] = referenceNodes.map((referenceNode) => {
    const hasShapeTree = getOneMatchingQuad(dataset, referenceNode, SHAPETREES.terms.hasShapeTree)
    const viaPredicate = getOneMatchingQuad(dataset, referenceNode, SHAPETREES.terms.viaPredicate)
    if (!hasShapeTree || !viaPredicate) {
      throw new Error(`shape tree ${id} has a reference missing hasShapeTree/viaPredicate`)
    }
    return {
      shapeTree: hasShapeTree.object.value,
      viaPredicate: viaPredicate.object as NamedNode,
    }
  })
  return {
    id: id,
    type: getAllMatchingQuads(dataset, node, RDF.terms.type).map((quad) => quad.object.value),
    shape: getOneMatchingQuad(dataset, node, SHAPETREES.terms.shape)?.object.value,
    describesInstance: getOneMatchingQuad(dataset, node, SHAPETREES.terms.describesInstance)?.object
      .value,
    expectsType: getOneMatchingQuad(dataset, node, SHAPETREES.terms.expectsType)?.object.value,
    descriptionLanguages: getAllMatchingQuads(dataset, null, SHAPETREES.terms.usesLanguage).map(
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
export async function fromJsonLd(doc: unknown, id: string): Promise<ShapeTreeData> {
  const dataset = await parseJsonld(JSON.stringify(doc), id)
  return fromDataset(dataset, id)
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

/**
 * Fetch and load a shape tree resource as a ShapeTreeData POJO
 * (fetched as application/ld+json).
 */
export async function loadShapeTree(id: string, fetch: WhatwgFetch): Promise<ShapeTreeData> {
  const response = await fetch(id, {
    headers: { Accept: 'application/ld+json' },
  })
  const doc = await response.json()
  return fromJsonLd(doc, id)
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
  fetch: WhatwgFetch
): Promise<ShapeTreeDescriptionData | null> {
  const response = await fetch(tree.id, {
    headers: { Accept: 'application/ld+json' },
  })
  const doc = await response.json()
  const dataset = await parseJsonld(JSON.stringify(doc), tree.id)
  const descriptionSetNode = getOneMatchingQuad(
    dataset,
    null,
    SHAPETREES.terms.usesLanguage,
    DataFactory.literal(lang, XSD.terms.language)
  )?.subject
  if (!descriptionSetNode) return null
  const descriptionNodes = getAllMatchingQuads(dataset, null, SHAPETREES.terms.describes).map(
    (quad) => quad.subject
  )
  const descriptionIri = descriptionNodes.find((node) =>
    getOneMatchingQuad(dataset, node, SHAPETREES.terms.inDescriptionSet, descriptionSetNode)
  )?.value
  return descriptionIri ? loadShapeTreeDescription(descriptionIri, fetch) : null
}

/** The type of resources the shape tree expects (as a NamedNode). */
export function expectsType(tree: ShapeTreeData): NamedNode {
  if (!tree.expectsType) {
    throw new Error(`shape tree ${tree.id} is missing expectsType`)
  }
  return DataFactory.namedNode(tree.expectsType)
}
