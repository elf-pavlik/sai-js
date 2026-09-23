import { INTEROP, frameNode, selectNode, withContext } from '@janeirodigital/interop-utils'
import { dataModelContext } from './context'

// ──────────────────────────
// Types
// ──────────────────────────

/** Identity of a data grant resource. */
export type GrantId = {
  /** IRI of the grant resource; absent until assigned by registry */
  id?: string

  /** rdf:type IRIs — captured from framing on read, written on PUT */
  type: string[]
}

/** Plain JSON representation of a Data Grant. */
export type GrantData = GrantId & {
  // String properties (single-value named nodes)
  grantee: string
  grantedBy: string
  dataOwner: string
  registeredShapeTree: string
  hasDataRegistration: string
  hasStorage: string
  scopeOfGrant: string

  // Array properties (multi-value named nodes)
  accessMode: string[]
  creatorAccessMode?: string[]
  hasDataInstance?: string[]

  // Optional reference IRIs
  inheritsFromGrant?: string // parent grant IRI (Inherited scope)
  delegationOfGrant?: string // source grant IRI (delegated grants)

  // Children discovered via inverse quads in the dataset (lazily resolved)
  hasInheritingGrant?: string[] // child grant IRIs
}

/** A grant that has been assigned its storage IRI. */
export type FinalGrantData = GrantData & Required<Pick<GrantData, 'id'>>

export interface GeneratedGrants {
  sourceGrants: FinalGrantData[]
  delegatedGrants: GrantData[]
}

// ──────────────────────────
// Read path: JSON-LD → GrantData
// ──────────────────────────

/** The grant's wire terms — the frame emits exactly these keys (nothing
 * foreign leaks in; `id`/`type` are always included). Absent properties are
 * omitted: set-container terms are arrays when present, absent means
 * `undefined` (no `''`/`[]` defaults — docs/jsonld.md). */
const GRANT_TERMS = [
  'grantee',
  'grantedBy',
  'dataOwner',
  'registeredShapeTree',
  'hasDataRegistration',
  'hasStorage',
  'scopeOfGrant',
  'accessMode',
  'creatorAccessMode',
  'hasDataInstance',
  'inheritsFromGrant',
  'delegationOfGrant',
  'hasInheritingGrant',
] as const

/**
 * Convert a JSON-LD document (fetched as application/ld+json) directly into a GrantData POJO.
 *
 * The document can be in expanded, compacted, or flattened form. The frame
 * resolves @reverse relationships (hasInheritingGrant) automatically and
 * emits exactly the grant's terms — the framed node IS the POJO.
 */
export async function fromJsonLd(doc: unknown, id: string): Promise<GrantData> {
  return selectNode(await frameNode(doc, dataModelContext, id), GRANT_TERMS) as unknown as GrantData
}

/**
 * Fetch and load a grant resource as a GrantData POJO.
 */

// ──────────────────────────
// Write path: GrantData → JSON-LD
// ──────────────────────────

/**
 * Build a JSON-LD document (with embedded context) ready for PUT as application/ld+json.
 *
 * The document uses the grant context so that `@reverse` relationships
 * (hasInheritingGrant) produce the correct RDF quads on the server side.
 */
export function toJsonLd(grant: FinalGrantData): Record<string, unknown> {
  return withContext(dataModelContext, grant)
}

/**
 * Derive the data registry IRI from the grant's hasDataRegistration.
 */
export function dataRegistryIri(grant: GrantData): string {
  const parts = grant.hasDataRegistration.split('/')
  return `${parts.slice(0, -2).join('/')}/`
}
