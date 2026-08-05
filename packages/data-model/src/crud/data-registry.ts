import {
  INTEROP,
  RDF,
  SPACE,
  discoverStorageDescription,
  getOneMatchingQuad,
} from '@janeirodigital/interop-utils'
import { DataFactory, Store } from 'n3'
import type { AuthorizationAgentFactory, DataRegistrationData, ShapeTreeData } from '..'
import { CRUDContainer, addStatement, iriForContained as containerIriForContained } from './container'
import { linkedIris } from './resource'
import { createDataRegistration } from './data-registration'

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
  factory: AuthorizationAgentFactory
): Promise<string[]> {
  return linkedIris(data.id, factory, INTEROP.hasDataRegistration)
}

export async function* registrations(
  data: DataRegistryData,
  factory: AuthorizationAgentFactory
): AsyncIterable<DataRegistrationData> {
  const iris = await hasDataRegistration(data, factory)
  for (const iri of iris) {
    yield factory.readable.dataRegistration(iri)
  }
}

export async function registeredShapeTrees(
  data: DataRegistryData,
  factory: AuthorizationAgentFactory
): Promise<ShapeTreeData[]> {
  const trees: ShapeTreeData[] = []
  for await (const registration of registrations(data, factory)) {
    trees.push(await factory.readable.shapeTree(registration.registeredShapeTree))
  }
  return trees
}

export async function createRegistration(
  data: DataRegistryData,
  factory: AuthorizationAgentFactory,
  registeredShapeTree: string
): Promise<DataRegistrationData> {
  for await (const registration of registrations(data, factory)) {
    if (registration.registeredShapeTree === registeredShapeTree) {
      throw new Error('registration already exists')
    }
  }
  const iri = iriForContained(data, factory, true)
  const dataRegistration = await factory.crud.dataRegistration(iri, {
    id: iri,
    registeredShapeTree,
    contains: [],
  })
  await createDataRegistration(dataRegistration, factory)

  // link to created data registration
  const quad = DataFactory.quad(
    DataFactory.namedNode(data.id),
    INTEROP.hasDataRegistration,
    DataFactory.namedNode(dataRegistration.id)
  )
  await addStatement(data.id, factory, quad)
  return dataRegistration
}

export async function storageIri(
  data: DataRegistryData,
  factory: AuthorizationAgentFactory
): Promise<string> {
  const storageDescriptionIri = await discoverStorageDescription(data.id, factory.fetch.raw)
  const response = await factory.fetch(storageDescriptionIri)
  const storageDescription = await response.dataset()
  return getOneMatchingQuad(storageDescription, null, RDF.type, SPACE.Storage).subject.value
}

export async function createDataRegistry(
  data: DataRegistryData,
  factory: AuthorizationAgentFactory
): Promise<void> {
  const dataset = new Store()
  dataset.add(DataFactory.quad(DataFactory.namedNode(data.id), RDF.type, INTEROP.DataRegistry))
  const container = new CRUDContainer(data.id, factory, {})
  container.dataset = dataset
  await container.create()
}

export function iriForContained(
  data: DataRegistryData,
  factory: AuthorizationAgentFactory,
  container = false
): string {
  return containerIriForContained(data.id, factory, container)
}
