import { INTEROP, RDF, getAllMatchingQuads, getOneMatchingQuad } from '@janeirodigital/interop-utils'
import { DataFactory, Store } from 'n3'
import type { AuthorizationAgentFactory } from '..'
import type { AgentRegistryData } from './agent-registry'
import type { AuthorizationRegistryData } from './authorization-registry'
import type { DataRegistryData } from './data-registry'
import type { GrantRegistryData } from './grant-registry'
import type { RoleRegistryData } from './role-registry'
import { CRUDResource, fetchDataset } from './resource'

// ──────────────────────────
// Types
// ──────────────────────────

export type RegistrySetData = {
  id: string
  hasAuthorizationRegistry: AuthorizationRegistryData
  hasGrantRegistry: GrantRegistryData
  hasAgentRegistry: AgentRegistryData
  hasRoleRegistry: RoleRegistryData
  hasDataRegistry: DataRegistryData[]
  factory: AuthorizationAgentFactory
}

export type RegistrySetDataInput = {
  hasAuthorizationRegistry: string
  hasGrantRegistry: string
  hasAgentRegistry: string
  hasRoleRegistry: string
  hasDataRegistry: string[]
}

// ──────────────────────────
// Behavior functions (replacing class methods)
// ──────────────────────────

export async function loadRegistrySet(
  iri: string,
  factory: AuthorizationAgentFactory,
  data?: RegistrySetDataInput
): Promise<RegistrySetData> {
  let hasAgentRegistryIri: string
  let hasAuthorizationRegistryIri: string
  let hasGrantRegistryIri: string
  let hasRoleRegistryIri: string
  let hasDataRegistryIris: string[]

  if (data) {
    hasAgentRegistryIri = data.hasAgentRegistry
    hasAuthorizationRegistryIri = data.hasAuthorizationRegistry
    hasGrantRegistryIri = data.hasGrantRegistry
    hasRoleRegistryIri = data.hasRoleRegistry
    hasDataRegistryIris = data.hasDataRegistry
  } else {
    const dataset = await fetchDataset(iri, factory)
    const node = DataFactory.namedNode(iri)
    hasAgentRegistryIri = getOneMatchingQuad(dataset, node, INTEROP.hasAgentRegistry)?.object.value
    hasAuthorizationRegistryIri = getOneMatchingQuad(
      dataset,
      node,
      INTEROP.hasAuthorizationRegistry
    )?.object.value
    hasGrantRegistryIri = getOneMatchingQuad(dataset, node, INTEROP.hasGrantRegistry)?.object.value
    hasRoleRegistryIri = getOneMatchingQuad(dataset, node, INTEROP.hasRoleRegistry)?.object.value
    hasDataRegistryIris = getAllMatchingQuads(dataset, node, INTEROP.hasDataRegistry).map(
      (quad) => quad.object.value
    )
  }

  return {
    id: iri,
    hasAuthorizationRegistry: { id: hasAuthorizationRegistryIri },
    hasGrantRegistry: { id: hasGrantRegistryIri },
    hasAgentRegistry: { id: hasAgentRegistryIri },
    hasRoleRegistry: { id: hasRoleRegistryIri },
    hasDataRegistry: hasDataRegistryIris.map((id) => ({ id })),
    factory,
  }
}

export async function updateRegistrySet(
  data: RegistrySetData,
  factory: AuthorizationAgentFactory
): Promise<void> {
  const dataset = new Store()
  const node = DataFactory.namedNode(data.id)
  dataset.add(DataFactory.quad(node, RDF.type, INTEROP.RegistrySet))
  dataset.add(DataFactory.quad(node, INTEROP.hasAgentRegistry, DataFactory.namedNode(data.hasAgentRegistry.id)))
  dataset.add(
    DataFactory.quad(
      node,
      INTEROP.hasAuthorizationRegistry,
      DataFactory.namedNode(data.hasAuthorizationRegistry.id)
    )
  )
  dataset.add(
    DataFactory.quad(node, INTEROP.hasGrantRegistry, DataFactory.namedNode(data.hasGrantRegistry.id))
  )
  dataset.add(
    DataFactory.quad(node, INTEROP.hasRoleRegistry, DataFactory.namedNode(data.hasRoleRegistry.id))
  )
  for (const dataRegistry of data.hasDataRegistry) {
    dataset.add(
      DataFactory.quad(node, INTEROP.hasDataRegistry, DataFactory.namedNode(dataRegistry.id))
    )
  }
  const resource = new CRUDResource(data.id, factory, {})
  resource.dataset = dataset
  await resource.update()
}
