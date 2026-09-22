import { frameNode, loader, opt, str, strs, withContext } from '@janeirodigital/interop-utils'
import { dataModelContext } from './context'

// ──────────────────────────
// Types
// ──────────────────────────

/** Identity of a data authorization resource. */
export type DataAuthorizationId = {
  /** IRI of the data authorization resource; absent until assigned by the registry */
  id?: string

  /** rdf:type IRIs — captured from framing on read, written on PUT */
  type: string[]
}

/** Plain JSON representation of a Data Authorization. */
export type DataAuthorizationData = DataAuthorizationId & {
  // String properties (single-value named nodes)
  grantee: string
  grantedBy: string
  registeredShapeTree: string
  scopeOfAuthorization: string
  dataOwner?: string
  hasDataRegistration?: string
  satisfiesAccessNeed?: string
  inheritsFromAuthorization?: string // parent data authorization IRI (Inherited scope)

  // Array properties (multi-value named nodes)
  accessMode: string[]
  creatorAccessMode?: string[]
  hasDataInstance?: string[]

  // Children discovered via inverse quads in the dataset (lazily resolved)
  hasInheritingAuthorization?: string[] // child data authorization IRIs
}

/** A data authorization that has been assigned its IRI. */
export type FinalDataAuthorizationData = DataAuthorizationData &
  Required<Pick<DataAuthorizationData, 'id'>>

// ──────────────────────────
// Read path: JSON-LD → DataAuthorizationData
// ──────────────────────────

/**
 * Convert a JSON-LD document (fetched as application/ld+json) directly into a
 * DataAuthorizationData POJO.
 *
 * The document can be in expanded, compacted, or flattened form.
 * Uses jsonld.frame with the shared data model context: every property
 * frames with `@embed: '@never'` + `@type: '@id'`, so all node references
 * compact to plain IRI strings and `@reverse` relationships
 * (hasInheritingAuthorization) resolve automatically — no unwrapping of
 * embedded nodes (docs/jsonld.md TODO 2).
 *
 * Also used by the Activity Registry decode (`loadActivity` → the
 * `AuthorizationGranted` object POJOs): the activity document is re-framed
 * per embedded object id (two-phase framing), so one read path serves both
 * the per-resource and the embedded cases.
 */
export async function fromJsonLd(doc: unknown, id: string): Promise<DataAuthorizationData> {
  const node = await frameNode(doc, dataModelContext, id)
  return {
    id: node.id ?? node['@id'],
    type: node.type ?? [],
    grantee: str(node, 'grantee'),
    grantedBy: str(node, 'grantedBy'),
    registeredShapeTree: str(node, 'registeredShapeTree'),
    scopeOfAuthorization: str(node, 'scopeOfAuthorization'),
    dataOwner: opt(node, 'dataOwner'),
    hasDataRegistration: opt(node, 'hasDataRegistration'),
    satisfiesAccessNeed: opt(node, 'satisfiesAccessNeed'),
    inheritsFromAuthorization: opt(node, 'inheritsFromAuthorization'),
    accessMode: strs(node, 'accessMode'),
    creatorAccessMode: strs(node, 'creatorAccessMode'),
    hasDataInstance: strs(node, 'hasDataInstance'),
    hasInheritingAuthorization: strs(node, 'hasInheritingAuthorization'),
  }
}

/**
 * Fetch and load a data authorization resource as a DataAuthorizationData POJO.
 */
export const loadDataAuthorization = loader(fromJsonLd)

// ──────────────────────────
// Write path: DataAuthorizationData → JSON-LD
// ──────────────────────────

/**
 * Build a JSON-LD document (with embedded context) ready for PUT as application/ld+json.
 *
 * The document uses the data authorization context so that `@reverse`
 * relationships (hasInheritingAuthorization) produce the correct RDF quads
 * on the server side.
 */
export function toJsonLd(data: FinalDataAuthorizationData): Record<string, unknown> {
  return withContext(dataModelContext, data)
}
