import { type WhatwgFetch, fetchJsonLd, frameDoc, parseJsonld } from '@janeirodigital/interop-utils'
import type { AccessNeedGroupDescriptionData } from '.'
import { findInLanguage, loadDescriptions } from './access-description-set'
import type { AccessNeedData } from './access-need'
import {
  accessNeed,
  reliableDescriptionLanguages as needReliableDescriptionLanguages,
} from './access-need'
import { dataModelContext } from './context'

// ──────────────────────────
// Types
// ──────────────────────────

/** Identity of an access need group. */
export type AccessNeedGroupId = {
  id: string
  /** rdf:type IRIs — captured from framing on read */
  type: string[]
}

/** Plain JSON representation of an access need group. */
export type AccessNeedGroupData = AccessNeedGroupId & {
  hasAccessNeed: string[]
  /** The group's access needs, loaded recursively. */
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
export async function fromJsonLd(doc: unknown, id: string): Promise<AccessNeedGroupData> {
  const node = (await frameDoc(doc, dataModelContext, id)) as any
  return {
    id: node.id ?? node['@id'],
    type: node.type ? (Array.isArray(node.type) ? node.type : [node.type]) : [],
    hasAccessNeed: node.hasAccessNeed ?? [],
    accessNeeds: [],
  }
}

export async function loadAccessNeedGroup(
  id: string,
  fetch: WhatwgFetch
): Promise<AccessNeedGroupData> {
  return fromJsonLd(await fetchJsonLd(id, fetch), id)
}

/**
 * Load an access need group with its access needs resolved recursively (the
 * composed read formerly `AuthorizationAgentFactory.accessNeedGroup`).
 */
export async function accessNeedGroup(
  id: string,
  fetch: WhatwgFetch,
  descriptionLang?: string
): Promise<AccessNeedGroupData> {
  const group = await loadAccessNeedGroup(id, fetch)
  group.accessNeeds = await Promise.all(
    group.hasAccessNeed.map((needIri) => accessNeed(needIri, fetch, descriptionLang))
  )
  return group
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
  fetch: WhatwgFetch
): Promise<AccessNeedGroupDescriptionData | undefined> {
  const response = await fetch(group.id, {
    headers: { Accept: 'application/ld+json' },
  })
  const doc = await response.json()
  const dataset = await parseJsonld(JSON.stringify(doc), group.id)
  const descriptionSetIri = findInLanguage(dataset, lang)
  if (!descriptionSetIri) return undefined
  const descriptionSet = { id: descriptionSetIri }
  const { accessNeedGroupDescriptions } = await loadDescriptions(descriptionSet, fetch)
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
  fetch: WhatwgFetch
): Promise<Set<string>> {
  let languages: Set<string> | null = null
  for (const need of group.accessNeeds) {
    const needLanguages = await needReliableDescriptionLanguages(need, fetch)
    if (!languages) {
      languages = needLanguages
    } else {
      languages = new Set([...languages].filter((lang) => needLanguages.has(lang)))
    }
  }
  return languages ?? new Set()
}
