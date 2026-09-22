import {
  INTEROP,
  frameNode,
  loader,
  opt,
  str,
  strs,
  withContext,
} from '@janeirodigital/interop-utils'
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

/**
 * Convert a JSON-LD document (fetched as application/ld+json) directly into a GrantData POJO.
 *
 * The document can be in expanded, compacted, or flattened form.
 * Uses jsonld.frame to resolve @reverse relationships (hasInheritingGrant)
 * automatically, without embedding child nodes.
 */
export async function fromJsonLd(doc: unknown, id: string): Promise<GrantData> {
  const node = await frameNode(doc, dataModelContext, id)
  return {
    id: node.id ?? node['@id'],
    type: node.type ?? [],
    grantee: str(node, 'grantee'),
    grantedBy: str(node, 'grantedBy'),
    dataOwner: str(node, 'dataOwner'),
    registeredShapeTree: str(node, 'registeredShapeTree'),
    hasDataRegistration: str(node, 'hasDataRegistration'),
    hasStorage: str(node, 'hasStorage'),
    scopeOfGrant: str(node, 'scopeOfGrant'),
    accessMode: strs(node, 'accessMode'),
    creatorAccessMode: strs(node, 'creatorAccessMode'),
    hasDataInstance: strs(node, 'hasDataInstance'),
    inheritsFromGrant: opt(node, 'inheritsFromGrant'),
    delegationOfGrant: opt(node, 'delegationOfGrant'),
    hasInheritingGrant: strs(node, 'hasInheritingGrant'),
  }
}

/**
 * Fetch and load a grant resource as a GrantData POJO.
 */
export const loadGrant = loader(fromJsonLd)

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
