import { type WhatwgFetch, fetchJsonLd, frameDoc, withContext } from '@janeirodigital/interop-utils'
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
 * Uses jsonld.frame to resolve @reverse relationships
 * (hasInheritingAuthorization) automatically, without embedding child nodes.
 */
export async function fromJsonLd(doc: unknown, id: string): Promise<DataAuthorizationData> {
  return compactNodeToDataAuthorizationData((await frameDoc(doc, dataModelContext, id)) as any)
}

/**
 * Extract the data authorization node from a framed JSON-LD output into a
 * DataAuthorizationData POJO.
 *
 * The framed output uses compacted form with @type: @id on all properties,
 * so values are plain IRI strings (or null/undefined when absent).
 */
function compactNodeToDataAuthorizationData(node: any): DataAuthorizationData {
  return {
    id: node.id ?? node['@id'],
    type: node.type ? (Array.isArray(node.type) ? node.type : [node.type]) : [],
    grantee: node.grantee,
    grantedBy: node.grantedBy,
    registeredShapeTree: node.registeredShapeTree,
    scopeOfAuthorization: node.scopeOfAuthorization,
    dataOwner: node.dataOwner ?? undefined,
    hasDataRegistration: node.hasDataRegistration ?? undefined,
    satisfiesAccessNeed: node.satisfiesAccessNeed ?? undefined,
    inheritsFromAuthorization: node.inheritsFromAuthorization ?? undefined,
    accessMode: node.accessMode ?? [],
    creatorAccessMode: node.creatorAccessMode ?? [],
    hasDataInstance: node.hasDataInstance ?? [],
    hasInheritingAuthorization: node.hasInheritingAuthorization ?? [],
  }
}

/**
 * Fetch and load a data authorization resource as a DataAuthorizationData POJO.
 */
export async function loadDataAuthorization(
  id: string,
  fetch: WhatwgFetch
): Promise<DataAuthorizationData> {
  return fromJsonLd(await fetchJsonLd(id, fetch), id)
}

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
