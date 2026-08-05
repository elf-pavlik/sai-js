import { INTEROP, getAllMatchingQuads, parseJsonld } from '@janeirodigital/interop-utils'
import type { DatasetCore } from '@rdfjs/types'
import { Store } from 'n3'
import type { AccessNeedDescriptionData, AuthorizationAgentFactory } from '.'
import { findInLanguage, loadDescriptions } from './access-description-set'
import { frameDataset, frameDoc, toStore, withContext } from './jsonld-utils'

const accessNeedContext = {
  id: '@id',
  type: '@type',
  registeredShapeTree: {
    '@id': 'http://www.w3.org/ns/solid/interop#registeredShapeTree',
    '@type': '@id',
  },
  inheritsFromNeed: {
    '@id': 'http://www.w3.org/ns/solid/interop#inheritsFromNeed',
    '@type': '@id',
  },
  hasInheritingNeed: {
    '@reverse': 'http://www.w3.org/ns/solid/interop#inheritsFromNeed',
    '@type': '@id',
    '@container': '@set',
  },
  accessMode: {
    '@id': 'http://www.w3.org/ns/solid/interop#accessMode',
    '@type': '@id',
    '@container': '@set',
  },
  required: { '@id': 'http://www.w3.org/ns/solid/interop#accessNecessity', '@type': '@id' },
}

// ──────────────────────────
// Types
// ──────────────────────────

/** Plain JSON representation of an access need. */
export type AccessNeedData = {
  id: string
  registeredShapeTree: string
  inheritsFromNeed?: string
  hasInheritingNeed: string[]
  accessMode: string[]
  /** Whether the need is required (interop:accessNecessity = interop:AccessRequired). */
  required: boolean
  /** Inheriting needs, loaded recursively by the factory. */
  children: AccessNeedData[]
  /** Languages used by description sets in the access needs document. */
  descriptionLanguages: string[]
}

// ──────────────────────────
// Read path: Dataset / JSON-LD → AccessNeedData
// ──────────────────────────

/**
 * Convert a parsed RDF dataset into an AccessNeedData POJO.
 *
 * Uses jsonld.frame with the accessNeedContext to resolve the @reverse
 * relationship (hasInheritingNeed) automatically. `descriptionLanguages` is
 * extracted directly from the quads since it lives on the description sets in
 * the document, not on the need node itself.
 */
export async function fromDataset(
  dataset: DatasetCore,
  iri: string
): Promise<AccessNeedData> {
  const node = (await frameDataset(dataset, accessNeedContext, iri)) as any
  const data = compactNodeToAccessNeedData(node)
  data.descriptionLanguages = getAllMatchingQuads(dataset, null, INTEROP.usesLanguage).map(
    (quad) => quad.object.value
  )
  return data
}

/**
 * Convert a JSON-LD document (fetched as application/ld+json) directly into an
 * AccessNeedData POJO. The document can be in expanded, compacted, or
 * flattened form.
 */
export async function fromJsonLd(doc: unknown, iri: string): Promise<AccessNeedData> {
  const dataset = await parseJsonld(JSON.stringify(doc), iri)
  const node = (await frameDataset(dataset, accessNeedContext, iri)) as any
  const data = compactNodeToAccessNeedData(node)
  data.descriptionLanguages = getAllMatchingQuads(dataset, null, INTEROP.usesLanguage).map(
    (quad) => quad.object.value
  )
  return data
}

function compactNodeToAccessNeedData(node: any): AccessNeedData {
  return {
    id: node.id ?? node['@id'],
    registeredShapeTree: node.registeredShapeTree,
    inheritsFromNeed: node.inheritsFromNeed ?? undefined,
    hasInheritingNeed: node.hasInheritingNeed ?? [],
    accessMode: node.accessMode ?? [],
    required: node.required === INTEROP.AccessRequired.value,
    children: [],
    descriptionLanguages: [],
  }
}

// ──────────────────────────
// Write path: AccessNeedData → Dataset / JSON-LD
// ──────────────────────────

/** Convert an AccessNeedData to an N3 Store (DatasetCore). */
export async function toDataset(data: AccessNeedData): Promise<Store> {
  return toStore(toJsonLd(data), data.id)
}

/**
 * Build a JSON-LD document (with embedded context) ready for PUT as
 * application/ld+json. The derived `children` and `descriptionLanguages`
 * fields are not stored RDF properties, so they are stripped.
 */
export function toJsonLd(data: AccessNeedData): Record<string, unknown> {
  const { children: _children, descriptionLanguages: _descriptionLanguages, ...rest } = data
  return withContext(accessNeedContext, rest)
}

// ──────────────────────────
// Behavior functions (replacing class methods)
// ──────────────────────────

/**
 * Fetch the access need description for the given language, or undefined when
 * the need's document has no description set for that language.
 */
export async function getDescription(
  need: AccessNeedData,
  lang: string,
  factory: AuthorizationAgentFactory
): Promise<AccessNeedDescriptionData | undefined> {
  const response = await factory.fetch.raw(need.id, {
    headers: { Accept: 'application/ld+json' },
  })
  const doc = await response.json()
  const dataset = await parseJsonld(JSON.stringify(doc), need.id)
  const descriptionSetIri = findInLanguage(dataset, lang)
  if (!descriptionSetIri) return undefined
  const descriptionSet = await factory.readable.accessDescriptionSet(descriptionSetIri)
  const { accessNeedDescriptions } = await loadDescriptions(descriptionSet, factory)
  return accessNeedDescriptions.find((description) => description.hasAccessNeed === need.id)
}

/**
 * Languages for which both the need and its shape tree have descriptions.
 */
export async function reliableDescriptionLanguages(
  need: AccessNeedData,
  factory: AuthorizationAgentFactory
): Promise<Set<string>> {
  const shapeTree = await factory.readable.shapeTree(need.registeredShapeTree)
  const shapeTreeLanguages = new Set(shapeTree.descriptionLanguages)
  return new Set(need.descriptionLanguages.filter((lang) => shapeTreeLanguages.has(lang)))
}
