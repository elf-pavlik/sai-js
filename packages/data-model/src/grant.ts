import { INTEROP, ACL } from '@janeirodigital/interop-utils'
import type { DatasetCore } from '@rdfjs/types'
import { Store } from 'n3'
import grantContext from './grant-context'
import type { BaseFactory } from './base-factory'
import { DataInstance } from './data-instance'
import { frameDataset, frameDoc, toStore, withContext } from './jsonld-utils'

// ──────────────────────────
// Types
// ──────────────────────────

/** Plain JSON representation of a Data Grant. */
export type GrantData = {
  /** IRI of the grant resource; absent until assigned by registry */
  id?: string

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
// Read path: Dataset → GrantData
// ──────────────────────────

/**
 * Convert a parsed RDF dataset into a GrantData POJO.
 *
 * Uses jsonld.frame with the grant context to resolve @reverse relationships
 * (hasInheritingGrant) automatically, without embedding child nodes.
 */
export async function fromDataset(dataset: DatasetCore, iri: string): Promise<GrantData> {
  return compactNodeToGrantData((await frameDataset(dataset, grantContext, iri)) as any)
}

/**
 * Convert a JSON-LD document (fetched as application/ld+json) directly into a GrantData POJO.
 *
 * The document can be in expanded, compacted, or flattened form.
 * Uses jsonld.frame to resolve @reverse relationships (hasInheritingGrant)
 * automatically, without embedding child nodes.
 */
export async function fromJsonLd(doc: unknown, iri: string): Promise<GrantData> {
  return compactNodeToGrantData((await frameDoc(doc, grantContext, iri)) as any)
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

// ──────────────────────────
// Write path: GrantData → Dataset / JSON-LD
// ──────────────────────────

/**
 * Convert a FinalGrantData to an N3 Store (DatasetCore).
 *
 * Steps:
 *   1. Attach the local context to the grant POJO
 *   2. Use jsonld.toRDF to convert the JSON-LD object directly to RDF quads
 *   3. Collect quads into an N3 Store
 *
 * The resulting dataset can be passed directly to an RdfFetch call
 * as the `dataset` option (the wrapper serializes it to turtle).
 */
export async function toDataset(grant: FinalGrantData): Promise<Store> {
  return toStore(toJsonLd(grant), grant.id)
}

/**
 * Build a JSON-LD document (with embedded context) ready for PUT as application/ld+json.
 *
 * The document uses the grant context so that `@reverse` relationships
 * (hasInheritingGrant) produce the correct RDF quads on the server side.
 */
export function toJsonLd(grant: FinalGrantData): Record<string, unknown> {
  return withContext(grantContext, grant)
}

// ──────────────────────────
// Behavior functions (replacing class methods)
// ──────────────────────────

/**
 * Iterate over data instances described by this grant.
 * Dispatches based on scopeOfGrant.
 */
export async function* getDataInstanceIterator(
  grant: GrantData,
  factory: BaseFactory
): AsyncIterable<DataInstance> {
  const { readable } = factory
  switch (grant.scopeOfGrant) {
    case INTEROP.AllFromRegistry.value: {
      const registration = await readable.dataRegistration(grant.hasDataRegistration)
      for (const iri of registration.contains) {
        yield factory.dataInstance(iri, grant)
      }
      break
    }
    case INTEROP.SelectedFromRegistry.value: {
      for (const iri of grant.hasDataInstance ?? []) {
        yield factory.dataInstance(iri, grant)
      }
      break
    }
    case INTEROP.Inherited.value: {
      const parent = await readable.dataGrant(grant.inheritsFromGrant!)
      for await (const parentInstance of getDataInstanceIterator(parent, factory)) {
        const childIterator = await parentInstance.getChildInstancesIterator(grant.registeredShapeTree)
        yield* childIterator
      }
      break
    }
    default:
      throw new Error(`Unknown scope: ${grant.scopeOfGrant}`)
  }
}

/**
 * Generate a new IRI for a data instance within this grant's registration.
 */
export function iriForNew(grant: GrantData, randomUUID: () => string): string {
  return `${grant.hasDataRegistration}${randomUUID()}`
}

/**
 * Create a new DataInstance under this grant.
 * Throws if the grant scope does not support creation.
 */
export async function newDataInstance(
  grant: GrantData,
  factory: BaseFactory,
  randomUUID: () => string,
  parent?: DataInstance
): Promise<DataInstance> {
  if (grant.scopeOfGrant === INTEROP.SelectedFromRegistry.value) {
    throw new Error('Cannot create instances from SelectedFromRegistry grant')
  }
  if (!parent && grant.scopeOfGrant === INTEROP.Inherited.value) {
    throw new Error('Inherited grant requires a parent instance')
  }
  const iri = iriForNew(grant, randomUUID)
  return DataInstance.build(iri, grant, factory, parent, true)
}

/**
 * Whether the grant allows creating new data instances.
 */
export function canCreate(grant: GrantData): boolean {
  if (grant.scopeOfGrant === INTEROP.SelectedFromRegistry.value) return false
  return grant.accessMode.includes(ACL.Write.value)
}

/**
 * Derive the data registry IRI from the grant's hasDataRegistration.
 */
export function dataRegistryIri(grant: GrantData): string {
  const parts = grant.hasDataRegistration.split('/')
  return `${parts.slice(0, -2).join('/')}/`
}
