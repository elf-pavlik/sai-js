import {
  INTEROP,
  RDF,
  type WhatwgFetch,
  createContainer,
  iriForContained,
} from '@janeirodigital/interop-utils'
import { DataFactory, Store } from 'n3'

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
