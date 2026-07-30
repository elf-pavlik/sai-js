import { INTEROP, ACL, parseJsonld } from '@janeirodigital/interop-utils'
import { JsonLdSerializer } from 'jsonld-streaming-serializer'
import type { DatasetCore } from '@rdfjs/types'
import { Store } from 'n3'
import grantContext from './grant-context'
import type { BaseFactory } from './base-factory'
import { DataInstance } from './data-instance'

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

/**
 * Convert a parsed RDF dataset into a compacted JSON-LD string using the local context,
 * then extract the node for the given IRI as a GrantData POJO.
 */
export async function fromDataset(dataset: DatasetCore, iri: string): Promise<GrantData> {
  const serializer = new JsonLdSerializer({ context: grantContext })
  let output = ''
  serializer.on('data', (chunk: string) => {
    output += chunk
  })

  return new Promise((resolve, reject) => {
    serializer.on('end', () => {
      try {
        const compacted = JSON.parse(output)
        // The compacted output may be a single node or a @graph array
        const nodes = compacted['@graph'] ?? [compacted]
        const node = nodes.find((n: any) => n['@id'] === iri)
        if (!node) throw new Error(`Node ${iri} not found in compacted output`)
        resolve(compactNodeToGrantData(node))
      } catch (e) {
        reject(e)
      }
    })
    serializer.on('error', reject)

    // Write all quads from the dataset
    for (const quad of dataset) {
      serializer.write(quad)
    }
    serializer.end()
  })
}

/**
 * Extract a term value from a compacted JSON-LD node.
 * Values with @type: @id appear as { "@id": "..." } after compaction.
 */
function termValue(value: any): string | undefined {
  if (value === undefined || value === null) return undefined
  return value['@id'] ?? String(value)
}

/**
 * Extract an array of term values.
 * @container: @set guarantees the value is always an array when present
 * (per JSON-LD 1.1 spec). Zero matching quads → key is absent → ?? [].
 */
function termArray(values: any): string[] {
  return (values ?? []).map((v: any) => termValue(v) ?? v)
}

function compactNodeToGrantData(node: any): GrantData {
  return {
    id: node['@id'],
    grantee: termValue(node.grantee)!,
    grantedBy: termValue(node.grantedBy)!,
    dataOwner: termValue(node.dataOwner)!,
    registeredShapeTree: termValue(node.registeredShapeTree)!,
    hasDataRegistration: termValue(node.hasDataRegistration)!,
    hasStorage: termValue(node.hasStorage)!,
    scopeOfGrant: termValue(node.scopeOfGrant)!,
    accessMode: termArray(node.accessMode),
    creatorAccessMode: termArray(node.creatorAccessMode),
    hasDataInstance: termArray(node.hasDataInstance),
    inheritsFromGrant: termValue(node.inheritsFromGrant),
    delegationOfGrant: termValue(node.delegationOfGrant),
    hasInheritingGrant: termArray(node.hasInheritingGrant),
  }
}

// ──────────────────────────
// Write path: GrantData → Dataset
// ──────────────────────────

/**
 * Convert a FinalGrantData to an N3 Store (DatasetCore).
 *
 * Steps:
 *   1. Attach the local context to the grant POJO
 *   2. JSON.stringify → JSON-LD string
 *   3. parseJsonld → N3 Store (via jsonld-streaming-parser)
 *
 * The resulting dataset can be passed directly to an RdfFetch call
 * as the `dataset` option (the wrapper serializes it to turtle).
 */
export async function toDataset(grant: FinalGrantData): Promise<Store> {
  const jsonldDoc = { '@context': grantContext, ...grant }
  const jsonldStr = JSON.stringify(jsonldDoc)
  const store = await parseJsonld(jsonldStr, grant.id)
  return store as Store
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
