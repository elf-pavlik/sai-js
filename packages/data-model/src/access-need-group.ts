import { INTEROP, parseJsonld } from '@janeirodigital/interop-utils'
import type { DatasetCore } from '@rdfjs/types'
import { Store } from 'n3'
import type { AccessNeedGroupDescriptionData, AuthorizationAgentFactory } from '.'
import { findInLanguage, loadDescriptions } from './access-description-set'
import type { AccessNeedData } from './access-need'
import { frameDataset, frameDoc, toStore, withContext } from './jsonld-utils'
import { reliableDescriptionLanguages as needReliableDescriptionLanguages } from './access-need'

const accessNeedGroupContext = {
  id: '@id',
  type: '@type',
  hasAccessNeed: {
    '@id': 'http://www.w3.org/ns/solid/interop#hasAccessNeed',
    '@type': '@id',
    '@container': '@set',
  },
}

// ──────────────────────────
// Types
// ──────────────────────────

/** Plain JSON representation of an access need group. */
export type AccessNeedGroupData = {
  id: string
  hasAccessNeed: string[]
  /** The group's access needs, loaded recursively by the factory. */
  accessNeeds: AccessNeedData[]
}

// ──────────────────────────
// Read path: Dataset / JSON-LD → AccessNeedGroupData
// ──────────────────────────

/**
 * Convert a parsed RDF dataset into an AccessNeedGroupData POJO.
 * Uses jsonld.frame with the accessNeedGroupContext.
 */
export async function fromDataset(
  dataset: DatasetCore,
  iri: string
): Promise<AccessNeedGroupData> {
  return compactNodeToAccessNeedGroupData(
    (await frameDataset(dataset, accessNeedGroupContext, iri)) as any
  )
}

/**
 * Convert a JSON-LD document (fetched as application/ld+json) directly into an
 * AccessNeedGroupData POJO. The document can be in expanded, compacted, or
 * flattened form.
 */
export async function fromJsonLd(doc: unknown, iri: string): Promise<AccessNeedGroupData> {
  return compactNodeToAccessNeedGroupData(
    (await frameDoc(doc, accessNeedGroupContext, iri)) as any
  )
}

function compactNodeToAccessNeedGroupData(node: any): AccessNeedGroupData {
  return {
    id: node.id ?? node['@id'],
    hasAccessNeed: node.hasAccessNeed ?? [],
    accessNeeds: [],
  }
}

// ──────────────────────────
// Write path: AccessNeedGroupData → Dataset / JSON-LD
// ──────────────────────────

/** Convert an AccessNeedGroupData to an N3 Store (DatasetCore). */
export async function toDataset(data: AccessNeedGroupData): Promise<Store> {
  return toStore(toJsonLd(data), data.id)
}

/**
 * Build a JSON-LD document (with embedded context) ready for PUT as
 * application/ld+json. The derived `accessNeeds` field is not an RDF property,
 * so it is stripped from the serialized document.
 */
export function toJsonLd(data: AccessNeedGroupData): Record<string, unknown> {
  const { accessNeeds: _accessNeeds, ...rest } = data
  return withContext(accessNeedGroupContext, rest)
}

// ──────────────────────────
// Behavior functions (replacing class methods)
// ──────────────────────────

/**
 * Fetch the access need group description for the given language, or undefined
 * when the group's document has no description set for that language.
 */
export async function getDescription(
  group: AccessNeedGroupData,
  lang: string,
  factory: AuthorizationAgentFactory
): Promise<AccessNeedGroupDescriptionData | undefined> {
  const response = await factory.fetch.raw(group.id, {
    headers: { Accept: 'application/ld+json' },
  })
  const doc = await response.json()
  const dataset = await parseJsonld(JSON.stringify(doc), group.id)
  const descriptionSetIri = findInLanguage(dataset, lang)
  if (!descriptionSetIri) return undefined
  const descriptionSet = await factory.readable.accessDescriptionSet(descriptionSetIri)
  const { accessNeedGroupDescriptions } = await loadDescriptions(descriptionSet, factory)
  return accessNeedGroupDescriptions.find(
    (description) => description.hasAccessNeedGroup === group.id
  )
}

/**
 * Languages for which every access need in the group (and its shape tree) has
 * descriptions.
 */
export async function reliableDescriptionLanguages(
  group: AccessNeedGroupData,
  factory: AuthorizationAgentFactory
): Promise<Set<string>> {
  let languages: Set<string> | null = null
  for (const need of group.accessNeeds) {
    const needLanguages = await needReliableDescriptionLanguages(need, factory)
    if (!languages) {
      languages = needLanguages
    } else {
      languages = new Set([...languages].filter((lang) => needLanguages.has(lang)))
    }
  }
  return languages ?? new Set()
}
