import { type WhatwgFetch, fetchJsonLd, frameDoc, parseJsonld } from '@janeirodigital/interop-utils'
import type { AccessNeedGroupDescriptionData, AuthorizationAgentFactory } from '.'
import { findInLanguage, loadDescriptions } from './access-description-set'
import type { AccessNeedData } from './access-need'
import { reliableDescriptionLanguages as needReliableDescriptionLanguages } from './access-need'
import { dataModelContext } from './context'

// ──────────────────────────
// Types
// ──────────────────────────

/** Plain JSON representation of an access need group. */
export type AccessNeedGroupData = {
  id: string
  /** rdf:type IRIs — captured from framing on read */
  type: string[]
  hasAccessNeed: string[]
  /** The group's access needs, loaded recursively by the factory. */
  accessNeeds: AccessNeedData[]
}

// ──────────────────────────
// Read path: JSON-LD → AccessNeedGroupData
// ──────────────────────────

/**
 * Convert a JSON-LD document (fetched as application/ld+json) directly into an
 * AccessNeedGroupData POJO. The document can be in expanded, compacted, or
 * flattened form.
 */
export async function fromJsonLd(doc: unknown, iri: string): Promise<AccessNeedGroupData> {
  const node = (await frameDoc(doc, dataModelContext, iri)) as any
  return {
    id: node.id ?? node['@id'],
    type: node.type ? (Array.isArray(node.type) ? node.type : [node.type]) : [],
    hasAccessNeed: node.hasAccessNeed ?? [],
    accessNeeds: [],
  }
}

export async function loadAccessNeedGroup(
  iri: string,
  fetch: WhatwgFetch
): Promise<AccessNeedGroupData> {
  return fromJsonLd(await fetchJsonLd(iri, fetch), iri)
}

// ──────────────────────────
// Behavior functions
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
  const response = await factory.fetch(group.id, {
    headers: { Accept: 'application/ld+json' },
  })
  const doc = await response.json()
  const dataset = await parseJsonld(JSON.stringify(doc), group.id)
  const descriptionSetIri = findInLanguage(dataset, lang)
  if (!descriptionSetIri) return undefined
  const descriptionSet = await factory.accessDescriptionSet(descriptionSetIri)
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
