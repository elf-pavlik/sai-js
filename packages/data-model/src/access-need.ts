import { INTEROP, parseJsonld, type WhatwgFetch } from '@janeirodigital/interop-utils'
import type { AccessNeedDescriptionData, AuthorizationAgentFactory } from '.'
import { findInLanguage, loadDescriptions } from './access-description-set'
import { documentValues, fetchJsonLd, frameDoc } from './jsonld-utils'

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
  /** rdf:type IRIs — captured from framing on read */
  type: string[]
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
// Read path: JSON-LD → AccessNeedData
// ──────────────────────────

/**
 * Convert a JSON-LD document (fetched as application/ld+json) directly into an
 * AccessNeedData POJO. The document can be in expanded, compacted, or
 * flattened form.
 *
 * Uses jsonld.frame with the accessNeedContext to resolve the @reverse
 * relationship (hasInheritingNeed) automatically. `descriptionLanguages` is
 * collected from the whole document (flattened), since it lives on the
 * description sets, not on the need node itself.
 */
export async function fromJsonLd(doc: unknown, iri: string): Promise<AccessNeedData> {
  const node = (await frameDoc(doc, accessNeedContext, iri)) as any
  return {
    id: node.id ?? node['@id'],
    type: node.type ? (Array.isArray(node.type) ? node.type : [node.type]) : [],
    registeredShapeTree: node.registeredShapeTree,
    inheritsFromNeed: node.inheritsFromNeed ?? undefined,
    hasInheritingNeed: node.hasInheritingNeed ?? [],
    accessMode: node.accessMode ?? [],
    required: node.required === INTEROP.AccessRequired.value,
    children: [],
    descriptionLanguages: await documentValues(doc, iri, INTEROP.usesLanguage.value),
  }
}

export async function loadAccessNeed(
  iri: string,
  fetch: WhatwgFetch
): Promise<AccessNeedData> {
  return fromJsonLd(await fetchJsonLd(iri, fetch), iri)
}

// ──────────────────────────
// Behavior functions
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
