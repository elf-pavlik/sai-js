import {
  INTEROP,
  RDF,
  SPACE,
  discoverStorageDescription,
} from '@janeirodigital/interop-utils'
import { DataFactory, Store } from 'n3'
import type { AuthorizationAgentFactory, DataRegistrationData, ShapeTreeData } from '..'
import { addStatement, createContainer, iriForContained as containerIriForContained } from './container'
import { createDataRegistration } from '../data-registration'
import { fetchJsonLd, findNodeIdByType, linkedIrisJsonLd } from '../jsonld-utils'

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
  return linkedIrisJsonLd(data.id, factory.fetch.raw, INTEROP.hasDataRegistration.value)
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
    type: [INTEROP.DataRegistration.value],
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
  const doc = await fetchJsonLd(storageDescriptionIri, factory.fetch.raw)
  return findNodeIdByType(doc, SPACE.Storage.value, storageDescriptionIri)
}

export async function createDataRegistry(
  data: DataRegistryData,
  factory: AuthorizationAgentFactory
): Promise<void> {
  const dataset = new Store()
  dataset.add(DataFactory.quad(DataFactory.namedNode(data.id), RDF.type, INTEROP.DataRegistry))
  await createContainer(data.id, factory, dataset)
}

export function iriForContained(
  data: DataRegistryData,
  factory: AuthorizationAgentFactory,
  container = false
): string {
  return containerIriForContained(data.id, factory, container)
}
