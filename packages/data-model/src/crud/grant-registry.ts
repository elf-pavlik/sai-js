import { INTEROP, RDF, type WhatwgFetch } from '@janeirodigital/interop-utils'
import { DataFactory, Store } from 'n3'
import { iriForContained as containerIriForContained, createContainer } from './container'

// ──────────────────────────
// Types
// ──────────────────────────

export type GrantRegistryData = {
  id: string
}

// ──────────────────────────
// Behavior functions
// ──────────────────────────

export async function createGrantRegistry(
  data: GrantRegistryData,
  fetch: WhatwgFetch
): Promise<void> {
  const dataset = new Store()
  dataset.add(
    DataFactory.quad(DataFactory.namedNode(data.id), RDF.terms.type, INTEROP.terms.GrantRegistry)
  )
  await createContainer(data.id, fetch, dataset)
}

export function iriForContained(
  data: GrantRegistryData,
  randomUUID: () => string,
  container = false
): string {
  return containerIriForContained(data.id, randomUUID, container)
}
