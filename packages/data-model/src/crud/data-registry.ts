import {
  INTEROP,
  RDF,
  SPACE,
  type WhatwgFetch,
  discoverStorageDescription,
  fetchJsonLd,
  findNodeIdByType,
} from '@janeirodigital/interop-utils'
import { DataFactory, Store } from 'n3'
import type { DataModelDependencies, DataRegistrationData, ShapeTreeData } from '..'
import { linkedIrisJsonLd } from '../context'
import { createDataRegistration, loadDataRegistration } from '../data-registration'
import { loadShapeTree } from '../shape-tree'
import {
  addStatement,
  iriForContained as containerIriForContained,
  createContainer,
} from './container'

// ──────────────────────────
// Types
// ──────────────────────────

export type DataRegistryData = {
  id: string
}

// ──────────────────────────
// Behavior functions (replacing class methods)
// ──────────────────────────

export async function hasDataRegistration(
  data: DataRegistryData,
  fetch: WhatwgFetch
): Promise<string[]> {
  return linkedIrisJsonLd(data.id, fetch, 'hasDataRegistration')
}

export async function* registrations(
  data: DataRegistryData,
  fetch: WhatwgFetch
): AsyncIterable<DataRegistrationData> {
  const iris = await hasDataRegistration(data, fetch)
  for (const iri of iris) {
    yield loadDataRegistration(iri, fetch)
  }
}

export async function registeredShapeTrees(
  data: DataRegistryData,
  fetch: WhatwgFetch
): Promise<ShapeTreeData[]> {
  const trees: ShapeTreeData[] = []
  for await (const registration of registrations(data, fetch)) {
    trees.push(await loadShapeTree(registration.registeredShapeTree, fetch))
  }
  return trees
}

export async function createRegistration(
  data: DataRegistryData,
  deps: DataModelDependencies,
  registeredShapeTree: string
): Promise<DataRegistrationData> {
  for await (const registration of registrations(data, deps.fetch)) {
    if (registration.registeredShapeTree === registeredShapeTree) {
      throw new Error('registration already exists')
    }
  }
  const iri = iriForContained(data, deps.randomUUID, true)
  const dataRegistration: DataRegistrationData = {
    id: iri,
    type: [INTEROP.DataRegistration],
    registeredShapeTree,
    contains: [],
  }
  await createDataRegistration(dataRegistration, deps.fetch)

  // link to created data registration
  const quad = DataFactory.quad(
    DataFactory.namedNode(data.id),
    INTEROP.terms.hasDataRegistration,
    DataFactory.namedNode(dataRegistration.id)
  )
  await addStatement(data.id, deps.fetch, quad)
  return dataRegistration
}

export async function storageIri(data: DataRegistryData, fetch: WhatwgFetch): Promise<string> {
  const storageDescriptionIri = await discoverStorageDescription(data.id, fetch)
  const doc = await fetchJsonLd(storageDescriptionIri, fetch)
  return findNodeIdByType(doc, SPACE.Storage, storageDescriptionIri)
}

export async function createDataRegistry(
  data: DataRegistryData,
  fetch: WhatwgFetch
): Promise<void> {
  const dataset = new Store()
  dataset.add(
    DataFactory.quad(DataFactory.namedNode(data.id), RDF.terms.type, INTEROP.terms.DataRegistry)
  )
  await createContainer(data.id, fetch, dataset)
}

export function iriForContained(
  data: DataRegistryData,
  randomUUID: () => string,
  container = false
): string {
  return containerIriForContained(data.id, randomUUID, container)
}
