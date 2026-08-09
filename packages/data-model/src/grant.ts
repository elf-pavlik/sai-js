import {
  ACL,
  INTEROP,
  type WhatwgFetch,
  fetchJsonLd,
  frameDoc,
  withContext,
} from '@janeirodigital/interop-utils'
import type { BaseFactory } from './base-factory'
import { dataModelContext } from './context'
import { childIris, frameDataInstance } from './data-instance'

// ──────────────────────────
// Types
// ──────────────────────────

/** Plain JSON representation of a Data Grant. */
export type GrantData = {
  /** IRI of the grant resource; absent until assigned by registry */
  id?: string

  /** rdf:type IRIs — captured from framing on read, written on PUT */
  type: string[]

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
export async function fromJsonLd(doc: unknown, iri: string): Promise<GrantData> {
  return compactNodeToGrantData((await frameDoc(doc, dataModelContext, iri)) as any)
}

/**
 * Extract the grant node from a framed JSON-LD output into a GrantData POJO.
 *
 * The framed output uses compacted form with @type: @id on all properties,
 * so values are plain IRI strings (or null/undefined when absent).
 * No @id-object unwrapping or array-flattening is needed.
 */
function compactNodeToGrantData(node: any): GrantData {
  return {
    id: node.id ?? node['@id'],
    type: node.type ? (Array.isArray(node.type) ? node.type : [node.type]) : [],
    grantee: node.grantee,
    grantedBy: node.grantedBy,
    dataOwner: node.dataOwner,
    registeredShapeTree: node.registeredShapeTree,
    hasDataRegistration: node.hasDataRegistration,
    hasStorage: node.hasStorage,
    scopeOfGrant: node.scopeOfGrant,
    accessMode: node.accessMode ?? [],
    creatorAccessMode: node.creatorAccessMode ?? [],
    hasDataInstance: node.hasDataInstance ?? [],
    inheritsFromGrant: node.inheritsFromGrant ?? undefined,
    delegationOfGrant: node.delegationOfGrant ?? undefined,
    hasInheritingGrant: node.hasInheritingGrant ?? [],
  }
}

/**
 * Fetch and load a grant resource as a GrantData POJO.
 */
export async function loadGrant(iri: string, fetch: WhatwgFetch): Promise<GrantData> {
  return fromJsonLd(await fetchJsonLd(iri, fetch), iri)
}

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

// ──────────────────────────
// Behavior functions (replacing class methods)
// ──────────────────────────

/**
 * Iterate over the IRIs (ids) of the data instances described by this grant.
 * Dispatches based on scopeOfGrant.
 */
export async function* getDataInstanceIterator(
  grant: GrantData,
  factory: BaseFactory
): AsyncIterable<string> {
  const { readable } = factory
  switch (grant.scopeOfGrant) {
    case INTEROP.AllFromRegistry: {
      const registration = await readable.dataRegistration(grant.hasDataRegistration)
      for (const iri of registration.contains) {
        yield iri
      }
      break
    }
    case INTEROP.SelectedFromRegistry: {
      for (const iri of grant.hasDataInstance ?? []) {
        yield iri
      }
      break
    }
    case INTEROP.Inherited: {
      const parentGrant = await readable.dataGrant(grant.inheritsFromGrant!)
      for await (const parentIri of getDataInstanceIterator(parentGrant, factory)) {
        yield* await getChildInstanceIris(
          parentGrant,
          parentIri,
          grant.registeredShapeTree,
          factory
        )
      }
      break
    }
    default:
      throw new Error(`Unknown scope: ${grant.scopeOfGrant}`)
  }
}

/**
 * Child instance IRIs referenced by a parent instance for a shape tree, via
 * the parent shape tree's reference predicate.
 */
async function getChildInstanceIris(
  parentGrant: GrantData,
  parentIri: string,
  childShapeTree: string,
  factory: BaseFactory
): Promise<string[]> {
  const parentShapeTree = await factory.readable.shapeTree(parentGrant.registeredShapeTree)
  const node = await frameDataInstance(parentIri, factory, parentShapeTree)
  return childIris(node, parentShapeTree, childShapeTree)
}

/**
 * Generate a new IRI for a data instance within this grant's registration.
 */
export function iriForNew(grant: GrantData, randomUUID: () => string): string {
  return `${grant.hasDataRegistration}${randomUUID()}`
}

/**
 * Whether the grant allows creating new data instances.
 */
export function canCreate(grant: GrantData): boolean {
  if (grant.scopeOfGrant === INTEROP.SelectedFromRegistry) return false
  return grant.accessMode.includes(ACL.Write)
}

/**
 * Derive the data registry IRI from the grant's hasDataRegistration.
 */
export function dataRegistryIri(grant: GrantData): string {
  const parts = grant.hasDataRegistration.split('/')
  return `${parts.slice(0, -2).join('/')}/`
}
