import { INTEROP, ACL } from '@janeirodigital/interop-utils'
import type { DatasetCore, Quad } from '@rdfjs/types'
import * as jsonldNs from 'jsonld'
import { Store } from 'n3'
import grantContext from './grant-context'
import type { BaseFactory } from './base-factory'
import { DataInstance } from './data-instance'

// CJS/ESM interop: jsonld is a CJS package; in the ESM bundle the namespace
// has the full exports only on .default.  Grab the full object so that all
// properties (fromRDF, compact, toRDF, expand, …) are available.
const jsonld = (jsonldNs as any).default ?? jsonldNs

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

// ──────────────────────────
// Read path: Dataset → GrantData
// ──────────────────────────

/** Build a JSON-LD frame that resolves the grant node at `iri` with all its
 * properties as plain node references (no embedding of referenced nodes).
 *
 * Each property in the grant context gets `@embed: "@never"` so that the
 * framing algorithm produces `@type: @id`-compacted plain IRI strings
 * instead of embedding full child graphs. This also resolves @reverse
 * relationships (hasInheritingGrant) automatically.
 */
function buildGrantFrame(iri: string): Record<string, unknown> {
  const frame: Record<string, unknown> = {
    '@context': grantContext,
    '@id': iri,
  }
  for (const [key, val] of Object.entries(grantContext)) {
    if (key === 'id' || key === 'type' || key === '@version') continue
    if (typeof val === 'object' && val !== null) {
      frame[key] = { '@embed': '@never' }
    }
  }
  return frame
}

/**
 * Convert a parsed RDF dataset into a GrantData POJO.
 *
 * Uses jsonld.frame with the grant context to resolve @reverse relationships
 * (hasInheritingGrant) automatically, without embedding child nodes.
 */
export async function fromDataset(dataset: DatasetCore, iri: string): Promise<GrantData> {
  const expanded = await jsonld.fromRDF(dataset)
  const framed = await jsonld.frame(expanded, buildGrantFrame(iri) as any)
  if (!(framed as any).id && !(framed as any)['@id']) {
    throw new Error(`Node ${iri} not found in framed output`)
  }
  return compactNodeToGrantData(framed as any)
}

/**
 * Convert a JSON-LD document (fetched as application/ld+json) directly into a GrantData POJO.
 *
 * The document can be in expanded, compacted, or flattened form.
 * Uses jsonld.frame to resolve @reverse relationships (hasInheritingGrant)
 * automatically, without embedding child nodes.
 */
export async function fromJsonLd(doc: unknown, iri: string): Promise<GrantData> {
  const framed = await jsonld.frame(doc, buildGrantFrame(iri) as any)
  if (!(framed as any).id && !(framed as any)['@id']) {
    throw new Error(`Node ${iri} not found in framed output`)
  }
  return compactNodeToGrantData(framed as any)
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
  const jsonldDoc = toJsonLd(grant)
  const dataset = await jsonld.toRDF(jsonldDoc, {
    base: grant.id,
  })
  const store = new Store()
  for (const quad of dataset as unknown as Iterable<Quad>) {
    store.add(quad)
  }
  return store as Store
}

/**
 * Build a JSON-LD document (with embedded context) ready for PUT as application/ld+json.
 *
 * The document uses the grant context so that `@reverse` relationships
 * (hasInheritingGrant) produce the correct RDF quads on the server side.
 */
export function toJsonLd(grant: FinalGrantData): Record<string, unknown> {
  return {
    '@context': grantContext,
    ...grant,
    // hasInheritingGrant uses @reverse + @type: @id, so plain IRI strings are
    // correctly interpreted as node references by jsonld.toRDF.
    hasInheritingGrant: grant.hasInheritingGrant,
  }
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
