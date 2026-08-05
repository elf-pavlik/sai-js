import { INTEROP, OIDC, RDF, getAllMatchingQuads, getOneMatchingQuad } from '@janeirodigital/interop-utils'
import type { DatasetCore } from '@rdfjs/types'
import { DataFactory, Store } from 'n3'
import type { AuthorizationAgentFactory } from '..'
import { type AgentRegistrationData, toDataset as registrationToDataset } from './agent-registration'
import { CRUDContainer } from './container'
import { fetchDataset } from './resource'

// ──────────────────────────
// Types
// ──────────────────────────

export type ApplicationRegistrationData = AgentRegistrationData & {
  hasDataGrant: string[]
  granted: boolean
  accessNeedGroup?: string
  hasAuthorizationCallbackEndpoint?: string
  name?: string
  logo?: string
}

// ──────────────────────────
// Read path: Dataset → ApplicationRegistrationData
// ──────────────────────────

export function fromDataset(dataset: DatasetCore, iri: string): ApplicationRegistrationData {
  const node = DataFactory.namedNode(iri)
  const registeredAgent = getOneMatchingQuad(dataset, node, INTEROP.registeredAgent)?.object.value
  const agentNode = DataFactory.namedNode(registeredAgent)
  const hasDataGrant = getAllMatchingQuads(dataset, node, INTEROP.hasDataGrant).map(
    (quad) => quad.object.value
  )
  return {
    id: iri,
    registeredAgent,
    hasDataGrant,
    granted: hasDataGrant.length > 0,
    accessNeedGroup: getOneMatchingQuad(dataset, agentNode, INTEROP.hasAccessNeedGroup)?.object
      .value,
    hasAuthorizationCallbackEndpoint: getOneMatchingQuad(
      dataset,
      agentNode,
      INTEROP.hasAuthorizationCallbackEndpoint
    )?.object.value,
    name: getOneMatchingQuad(dataset, agentNode, OIDC.client_name)?.object.value,
    logo: getOneMatchingQuad(dataset, agentNode, OIDC.logo_uri)?.object.value,
  }
}

export async function loadApplicationRegistration(
  iri: string,
  factory: AuthorizationAgentFactory
): Promise<ApplicationRegistrationData> {
  const dataset = await fetchDataset(iri, factory)
  return fromDataset(dataset, iri)
}

// ──────────────────────────
// Write path: ApplicationRegistrationData → Dataset
// ──────────────────────────

export async function toDataset(data: ApplicationRegistrationData): Promise<Store> {
  const store = await registrationToDataset(data)
  const agentNode = DataFactory.namedNode(data.registeredAgent)
  if (data.accessNeedGroup) {
    store.add(
      DataFactory.quad(agentNode, INTEROP.hasAccessNeedGroup, DataFactory.namedNode(data.accessNeedGroup))
    )
  }
  if (data.hasAuthorizationCallbackEndpoint) {
    store.add(
      DataFactory.quad(
        agentNode,
        INTEROP.hasAuthorizationCallbackEndpoint,
        DataFactory.namedNode(data.hasAuthorizationCallbackEndpoint)
      )
    )
  }
  if (data.name) {
    store.add(DataFactory.quad(agentNode, OIDC.client_name, DataFactory.literal(data.name)))
  }
  if (data.logo) {
    store.add(DataFactory.quad(agentNode, OIDC.logo_uri, DataFactory.namedNode(data.logo)))
  }
  return store
}

export async function createApplicationRegistration(
  data: ApplicationRegistrationData,
  factory: AuthorizationAgentFactory
): Promise<void> {
  const dataset = await toDataset(data)
  dataset.add(DataFactory.quad(DataFactory.namedNode(data.id), RDF.type, INTEROP.ApplicationRegistration))
  const container = new CRUDContainer(data.id, factory, {})
  container.dataset = dataset
  await container.create()
}
