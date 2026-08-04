import {
  INTEROP,
  XSD,
  getAllMatchingQuads,
  getOneMatchingQuad,
  parseJsonld,
} from '@janeirodigital/interop-utils'
import type { DatasetCore } from '@rdfjs/types'
import { DataFactory } from 'n3'
import type { AuthorizationAgentFactory } from './authorization-agent-factory'
import type { AccessNeedDescriptionData, AccessNeedGroupDescriptionData } from './access-description'

// ──────────────────────────
// Types
// ──────────────────────────

/**
 * Plain JSON representation of an access description set resource.
 *
 * The set's own data is only its identity; the description IRIs it groups are
 * derived from its dataset via the forAccessNeed / forAccessNeedGroup free
 * functions, and the description POJOs are resolved by loadDescriptions.
 */
export type AccessDescriptionSetData = {
  id: string
}

// ──────────────────────────
// Behavior functions (replacing class methods)
// ──────────────────────────

/** All subjects in the dataset that point interop:inAccessDescriptionSet at the set. */
function descriptionIrisInSet(dataset: DatasetCore, setIri: string): string[] {
  return getAllMatchingQuads(
    dataset,
    null,
    INTEROP.inAccessDescriptionSet,
    DataFactory.namedNode(setIri)
  ).map((quad) => quad.subject.value)
}

/**
 * IRIs of the access need descriptions in the set.
 * A description belongs to the set when it points interop:inAccessDescriptionSet
 * at the set and carries interop:hasAccessNeed.
 */
export function forAccessNeed(dataset: DatasetCore, setIri: string): string[] {
  return descriptionIrisInSet(dataset, setIri).filter(
    (iri) => dataset.match(DataFactory.namedNode(iri), INTEROP.hasAccessNeed).size > 0
  )
}

/**
 * IRIs of the access need group descriptions in the set.
 * A description belongs to the set when it points interop:inAccessDescriptionSet
 * at the set and carries interop:hasAccessNeedGroup.
 */
export function forAccessNeedGroup(dataset: DatasetCore, setIri: string): string[] {
  return descriptionIrisInSet(dataset, setIri).filter(
    (iri) => dataset.match(DataFactory.namedNode(iri), INTEROP.hasAccessNeedGroup).size > 0
  )
}

/**
 * Find the access description set IRI that uses the given language in the
 * given dataset (e.g. the dataset of an access need or access need group
 * resource).
 */
export function findInLanguage(dataset: DatasetCore, descriptionLang: string): string | undefined {
  // we can skip matching on INTEROP.hasAccessDescriptionSet since nothing else uses INTEROP.usesLanguage
  return getOneMatchingQuad(
    dataset,
    null,
    INTEROP.usesLanguage,
    DataFactory.literal(descriptionLang, XSD.language)
  )?.subject.value
}

/**
 * Resolve the description POJOs for the set (replaces the class bootstrap).
 *
 * Fetches the set's dataset, derives the description IRIs with
 * forAccessNeed / forAccessNeedGroup, and loads each description POJO.
 */
export async function loadDescriptions(
  set: AccessDescriptionSetData,
  factory: AuthorizationAgentFactory
): Promise<{
  accessNeedDescriptions: AccessNeedDescriptionData[]
  accessNeedGroupDescriptions: AccessNeedGroupDescriptionData[]
}> {
  const response = await factory.fetch.raw(set.id, {
    headers: { Accept: 'application/ld+json' },
  })
  const doc = await response.json()
  const dataset = await parseJsonld(JSON.stringify(doc), set.id)
  const [accessNeedDescriptions, accessNeedGroupDescriptions] = await Promise.all([
    Promise.all(
      forAccessNeed(dataset, set.id).map((iri) => factory.readable.accessNeedDescription(iri))
    ),
    Promise.all(
      forAccessNeedGroup(dataset, set.id).map((iri) =>
        factory.readable.accessNeedGroupDescription(iri)
      )
    ),
  ])
  return { accessNeedDescriptions, accessNeedGroupDescriptions }
}
