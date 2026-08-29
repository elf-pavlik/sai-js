import { INTEROP } from '@janeirodigital/interop-utils'
import { DataFactory, Store } from 'n3'

// ──────────────────────────
// Types
// ──────────────────────────

export type AgentRegistrationId = {
  id: string
  /** rdf:type IRIs — captured from framing on read (via the derived modules), written via compaction on write */
  type: string[]
}

export type AgentRegistrationData = AgentRegistrationId & {
  registeredAgent: string
  hasDataGrant?: string[]
}

// ──────────────────────────
// Write path: AgentRegistrationData → Dataset
// ──────────────────────────

export async function toDataset(data: AgentRegistrationData): Promise<Store> {
  const store = new Store()
  const node = DataFactory.namedNode(data.id)
  if (data.registeredAgent) {
    store.add(
      DataFactory.quad(
        node,
        INTEROP.terms.registeredAgent,
        DataFactory.namedNode(data.registeredAgent)
      )
    )
  }
  if (data.hasDataGrant) {
    for (const grantIri of data.hasDataGrant) {
      store.add(DataFactory.quad(node, INTEROP.terms.hasDataGrant, DataFactory.namedNode(grantIri)))
    }
  }
  return store
}

// ──────────────────────────
// Accessors
// ──────────────────────────

export async function getDataGrantIris(data: AgentRegistrationData): Promise<string[]> {
  return data.hasDataGrant ?? []
}
