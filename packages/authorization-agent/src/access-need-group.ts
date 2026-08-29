import {
  type AccessNeedGroupData,
  type AccessNeedGroupDescriptionData,
  loadAccessNeedGroup,
} from '@janeirodigital/interop-data-model'
import { type WhatwgFetch, parseJsonld } from '@janeirodigital/interop-utils'
import { findInLanguage, loadDescriptions } from './access-description-set'
import {
  accessNeed,
  reliableDescriptionLanguages as needReliableDescriptionLanguages,
} from './access-need'

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
