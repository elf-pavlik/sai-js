import {
  INTEROP,
  type WhatwgFetch,
  documentValues,
  fetchJsonLd,
  frameDoc,
  parseJsonld,
} from '@janeirodigital/interop-utils'
import type { AccessNeedDescriptionData } from '.'
import { findInLanguage, loadDescriptions } from './access-description-set'
import { dataModelContext } from './context'
import { loadShapeTree } from './shape-tree'

// ──────────────────────────
// Types
// ──────────────────────────

/** Identity of an access need. */
export type AccessNeedId = {
  id: string
  /** rdf:type IRIs — captured from framing on read */
  type: string[]
}

/** Plain JSON representation of an access need. */
export type AccessNeedData = AccessNeedId & {
  registeredShapeTree: string
  inheritsFromNeed?: string
  hasInheritingNeed: string[]
  accessMode: string[]
  /** Whether the need is required (interop:accessNecessity = interop:AccessRequired). */
  required: boolean
  /** Inheriting needs, loaded recursively. */
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
 * Uses jsonld.frame with the dataModelContext to resolve the @reverse
 * relationship (hasInheritingNeed) automatically. `descriptionLanguages` is
 * collected from the whole document (flattened), since it lives on the
 * description sets, not on the need node itself.
 */
export async function fromJsonLd(doc: unknown, id: string): Promise<AccessNeedData> {
  const node = (await frameDoc(doc, dataModelContext, id)) as any
  return {
    id: node.id ?? node['@id'],
    type: node.type ? (Array.isArray(node.type) ? node.type : [node.type]) : [],
    registeredShapeTree: node.registeredShapeTree,
    inheritsFromNeed: node.inheritsFromNeed ?? undefined,
    hasInheritingNeed: node.hasInheritingNeed ?? [],
    accessMode: node.accessMode ?? [],
    required: node.required === INTEROP.AccessRequired,
    children: [],
    descriptionLanguages: await documentValues(doc, id, INTEROP.usesLanguage),
  }
}

export async function loadAccessNeed(id: string, fetch: WhatwgFetch): Promise<AccessNeedData> {
  return fromJsonLd(await fetchJsonLd(id, fetch), id)
}

/**
 * Load an access need with its inheriting needs resolved recursively (the
 * composed read formerly `AuthorizationAgentFactory.accessNeed`).
 */
export async function accessNeed(
  id: string,
  fetch: WhatwgFetch,
  descriptionLang?: string
): Promise<AccessNeedData> {
  const need = await loadAccessNeed(id, fetch)
  if (need.hasInheritingNeed.length) {
    need.children = await Promise.all(
      need.hasInheritingNeed.map((childIri) => accessNeed(childIri, fetch, descriptionLang))
    )
  }
  return need
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
  fetch: WhatwgFetch
): Promise<AccessNeedDescriptionData | undefined> {
  const response = await fetch(need.id, {
    headers: { Accept: 'application/ld+json' },
  })
  const doc = await response.json()
  const dataset = await parseJsonld(JSON.stringify(doc), need.id)
  const descriptionSetIri = findInLanguage(dataset, lang)
  if (!descriptionSetIri) return undefined
  const descriptionSet = { id: descriptionSetIri }
  const { accessNeedDescriptions } = await loadDescriptions(descriptionSet, fetch)
  return accessNeedDescriptions.find((description) => description.hasAccessNeed === need.id)
}

/**
 * Languages for which both the need and its shape tree have descriptions.
 */
export async function reliableDescriptionLanguages(
  need: AccessNeedData,
  fetch: WhatwgFetch
): Promise<Set<string>> {
  const shapeTree = await loadShapeTree(need.registeredShapeTree, fetch)
  const shapeTreeLanguages = new Set(shapeTree.descriptionLanguages)
  return new Set(need.descriptionLanguages.filter((lang) => shapeTreeLanguages.has(lang)))
}
