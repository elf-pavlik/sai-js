import {
  INTEROP,
  type WhatwgFetch,
  fetchJsonLd,
  frameDoc,
  withContext,
} from '@janeirodigital/interop-utils'
import { dataModelContext } from './context'
import { childIris, frameDataInstance } from './data-instance'
import { loadDataRegistration } from './data-registration'
import { loadShapeTree } from './shape-tree'

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
  return compactNodeToGrantData((await frameDoc(doc, dataModelContext, id)) as any)
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
export async function loadGrant(id: string, fetch: WhatwgFetch): Promise<GrantData> {
  return fromJsonLd(await fetchJsonLd(id, fetch), id)
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
 *
 * TODO (reorganize-authz-agent-logic Phase 4): the components consumer
 * (services/DataRegistry) may switch to an AA SPARQL-backed enumeration
 * (`getDataRegistration().contains` / `grant.hasDataInstance` — both already
 * reachable via the AA's `sparql.ts`), after which the application copy in
 * `packages/application/src/grant.ts` becomes the single home.
 */
export async function* getDataInstanceIterator(
  grant: GrantData,
  fetch: WhatwgFetch
): AsyncIterable<string> {
  switch (grant.scopeOfGrant) {
    case INTEROP.AllFromRegistry: {
      const registration = await loadDataRegistration(grant.hasDataRegistration, fetch)
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
      const parentGrant = await loadGrant(grant.inheritsFromGrant!, fetch)
      for await (const parentIri of getDataInstanceIterator(parentGrant, fetch)) {
        yield* await getChildInstanceIris(parentGrant, parentIri, grant.registeredShapeTree, fetch)
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
  fetch: WhatwgFetch
): Promise<string[]> {
  const parentShapeTree = await loadShapeTree(parentGrant.registeredShapeTree, fetch)
  const node = await frameDataInstance(parentIri, fetch, parentShapeTree)
  return childIris(node, parentShapeTree, childShapeTree)
}

/**
 * Derive the data registry IRI from the grant's hasDataRegistration.
 */
export function dataRegistryIri(grant: GrantData): string {
  const parts = grant.hasDataRegistration.split('/')
  return `${parts.slice(0, -2).join('/')}/`
}
