import { INTEROP, RDF } from '@janeirodigital/interop-utils'
import { DataFactory, Store } from 'n3'
import type { AuthorizationAgentFactory } from '..'
import type { DataRegistrationData } from '../data-registration'
import { CRUDContainer } from './container'

// ──────────────────────────
// Write path: DataRegistrationData → Dataset
// ──────────────────────────

export async function toDataset(data: DataRegistrationData): Promise<Store> {
  const store = new Store()
  const node = DataFactory.namedNode(data.id)
  store.add(
    DataFactory.quad(node, INTEROP.registeredShapeTree, DataFactory.namedNode(data.registeredShapeTree))
  )
  return store
}

export async function createDataRegistration(
  data: DataRegistrationData,
  factory: AuthorizationAgentFactory
): Promise<void> {
  const dataset = await toDataset(data)
  dataset.add(DataFactory.quad(DataFactory.namedNode(data.id), RDF.type, INTEROP.DataRegistration))
  const container = new CRUDContainer(data.id, factory, {})
  container.dataset = dataset
  await container.create()
}
