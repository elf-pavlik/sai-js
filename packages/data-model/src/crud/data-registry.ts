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
import { iriForContained as containerIriForContained, createContainer } from './container'

// ──────────────────────────
// Types
// ──────────────────────────

export type DataRegistryData = {
  id: string
}

// ──────────────────────────
// Behavior functions (replacing class methods)
// ──────────────────────────

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
