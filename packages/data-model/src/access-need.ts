import {
  INTEROP,
  documentValues,
  frameNode,
  loader,
  opt,
  str,
  strs,
} from '@janeirodigital/interop-utils'
import { dataModelContext } from './context'

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
  /** Inheriting needs, loaded recursively (see the AA `accessNeed` composed read). */
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
  const node = await frameNode(doc, dataModelContext, id)
  return {
    id: node.id ?? node['@id'],
    type: node.type ?? [],
    registeredShapeTree: str(node, 'registeredShapeTree'),
    inheritsFromNeed: opt(node, 'inheritsFromNeed'),
    hasInheritingNeed: strs(node, 'hasInheritingNeed'),
    accessMode: strs(node, 'accessMode'),
    required: node.required === INTEROP.AccessRequired,
    children: [],
    descriptionLanguages: await documentValues(doc, id, INTEROP.usesLanguage),
  }
}

export const loadAccessNeed = loader(fromJsonLd)
