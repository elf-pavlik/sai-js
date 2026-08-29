import { INTEROP, RDF, type WhatwgFetch } from '@janeirodigital/interop-utils'
import { createContainer, iriForContained } from '@janeirodigital/interop-utils'
import { DataFactory, Store } from 'n3'

// ──────────────────────────
// Types
// ──────────────────────────

export type DataRegistryData = {
  id: string
}

// ──────────────────────────
// Behavior functions (replacing class methods)
// ──────────────────────────

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
