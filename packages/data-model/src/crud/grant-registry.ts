import { INTEROP, RDF } from '@janeirodigital/interop-utils'
import { DataFactory, Store } from 'n3'
import type { AuthorizationAgentFactory } from '..'
import type { AgentAndClient } from '../templates/types'
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
  factory: AuthorizationAgentFactory,
  creator: AgentAndClient
): Promise<void> {
  const dataset = new Store()
  dataset.add(
    DataFactory.quad(DataFactory.namedNode(data.id), RDF.terms.type, INTEROP.terms.GrantRegistry)
  )
  await createContainer(data.id, factory, creator, dataset)
}

export function iriForContained(
  data: GrantRegistryData,
  factory: AuthorizationAgentFactory,
  container = false
): string {
  return containerIriForContained(data.id, factory, container)
}
