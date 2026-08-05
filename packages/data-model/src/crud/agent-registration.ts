import {
  INTEROP,
  getAllMatchingQuads,
  getOneMatchingQuad,
  discoverAccessResource,
  parseTurtle,
} from '@janeirodigital/interop-utils'
import type { DatasetCore } from '@rdfjs/types'
import { DataFactory, Store } from 'n3'
import type { AuthorizationAgentFactory, GrantData } from '..'
import { agentRegistrationAcrTemplate } from '../templates/AgentRegistration.acr'
import type { AgentAndClient } from '../templates/types'
import { addStatement, removeStatement } from './container'
import { fetchDataset } from './resource'

// ──────────────────────────
// Types
// ──────────────────────────

export type AgentRegistrationData = {
  id: string
  registeredAgent: string
  hasDataGrant?: string[]
}

// ──────────────────────────
// Read path: Dataset → AgentRegistrationData
// ──────────────────────────

export function fromDataset(dataset: DatasetCore, iri: string): AgentRegistrationData {
  const node = DataFactory.namedNode(iri)
  const hasDataGrant = getAllMatchingQuads(dataset, node, INTEROP.hasDataGrant).map(
    (quad) => quad.object.value
  )
  return {
    id: iri,
    registeredAgent: getOneMatchingQuad(dataset, node, INTEROP.registeredAgent)?.object.value,
    hasDataGrant,
  }
}

export async function loadAgentRegistration(
  iri: string,
  factory: AuthorizationAgentFactory
): Promise<AgentRegistrationData> {
  const dataset = await fetchDataset(iri, factory)
  return fromDataset(dataset, iri)
}

// ──────────────────────────
// Write path: AgentRegistrationData → Dataset
// ──────────────────────────

export async function toDataset(data: AgentRegistrationData): Promise<Store> {
  const store = new Store()
  const node = DataFactory.namedNode(data.id)
  if (data.registeredAgent) {
    store.add(
      DataFactory.quad(node, INTEROP.registeredAgent, DataFactory.namedNode(data.registeredAgent))
    )
  }
  if (data.hasDataGrant) {
    for (const grantIri of data.hasDataGrant) {
      store.add(DataFactory.quad(node, INTEROP.hasDataGrant, DataFactory.namedNode(grantIri)))
    }
  }
  return store
}

// ──────────────────────────
// Behavior functions (replacing class methods)
// ──────────────────────────

export async function setAcr(
  data: AgentRegistrationData,
  factory: AuthorizationAgentFactory,
  owner: AgentAndClient,
  peer: AgentAndClient
): Promise<void> {
  const acrLocation = await discoverAccessResource(data.id, factory.fetch)
  const dataset = await parseTurtle(
    agentRegistrationAcrTemplate({
      id: data.id,
      owner,
      peer,
    })
  )
  const response = await factory.fetch(acrLocation, {
    method: 'PUT',
    dataset,
  })
  if (!response.ok) throw new Error(await response.text())
}

export async function getDataGrantIris(
  data: AgentRegistrationData,
  factory: AuthorizationAgentFactory
): Promise<string[]> {
  if (data.hasDataGrant) return data.hasDataGrant
  const dataset = await fetchDataset(data.id, factory)
  return getAllMatchingQuads(dataset, DataFactory.namedNode(data.id), INTEROP.hasDataGrant).map(
    (quad) => quad.object.value
  )
}

export async function getGranted(
  data: AgentRegistrationData,
  factory: AuthorizationAgentFactory
): Promise<boolean> {
  return (await getDataGrantIris(data, factory)).length > 0
}

export async function getDataGrants(
  data: AgentRegistrationData,
  factory: AuthorizationAgentFactory
): Promise<GrantData[]> {
  const iris = await getDataGrantIris(data, factory)
  return Promise.all(iris.map((iri) => factory.readable.dataGrant(iri)))
}

export async function addDataGrant(
  data: AgentRegistrationData,
  factory: AuthorizationAgentFactory,
  grantIri: string
): Promise<void> {
  const quad = DataFactory.quad(
    DataFactory.namedNode(data.id),
    INTEROP.hasDataGrant,
    DataFactory.namedNode(grantIri)
  )
  await addStatement(data.id, factory, quad)
  data.hasDataGrant = [...(data.hasDataGrant ?? []), grantIri]
}

export async function removeDataGrant(
  data: AgentRegistrationData,
  factory: AuthorizationAgentFactory,
  grantIri: string
): Promise<void> {
  const quad = DataFactory.quad(
    DataFactory.namedNode(data.id),
    INTEROP.hasDataGrant,
    DataFactory.namedNode(grantIri)
  )
  await removeStatement(data.id, factory, quad)
  data.hasDataGrant = (data.hasDataGrant ?? []).filter((iri) => iri !== grantIri)
}

export async function removeAllDataGrants(
  data: AgentRegistrationData,
  factory: AuthorizationAgentFactory
): Promise<void> {
  const iris = await getDataGrantIris(data, factory)
  await Promise.all(iris.map((iri) => removeDataGrant(data, factory, iri)))
}
