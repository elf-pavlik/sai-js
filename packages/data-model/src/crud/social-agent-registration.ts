import {
  INTEROP,
  RDF,
  SKOS,
  type WhatwgFetch,
  getAllMatchingQuads,
  getOneMatchingQuad,
  discoverAgentRegistration,
  discoverAuthorizationAgent,
} from '@janeirodigital/interop-utils'
import { DataFactory, Store } from 'n3'
import type { AuthorizationAgentFactory } from '..'
import { type AgentRegistrationData, toDataset as registrationToDataset } from './agent-registration'
import { CRUDContainer, addStatement, replaceStatement } from './container'
import { fetchDataset } from './resource'

// ──────────────────────────
// Types
// ──────────────────────────

export type SocialAgentRegistrationData = AgentRegistrationData & {
  prefLabel: string
  note?: string
  hasAccessNeedGroup?: string
  reciprocalRegistration?: SocialAgentRegistrationData
}

// ──────────────────────────
// Read path: Dataset → SocialAgentRegistrationData
// ──────────────────────────

export async function loadSocialAgentRegistration(
  iri: string,
  factory: AuthorizationAgentFactory,
  reciprocal = false
): Promise<SocialAgentRegistrationData> {
  const dataset = await fetchDataset(iri, factory)
  const node = DataFactory.namedNode(iri)
  const hasDataGrant = getAllMatchingQuads(dataset, node, INTEROP.hasDataGrant).map(
    (quad) => quad.object.value
  )
  const data: SocialAgentRegistrationData = {
    id: iri,
    registeredAgent: getOneMatchingQuad(dataset, node, INTEROP.registeredAgent)?.object.value,
    hasDataGrant,
    prefLabel: getOneMatchingQuad(dataset, node, SKOS.prefLabel)?.object.value ?? '',
    note: getOneMatchingQuad(dataset, node, SKOS.note)?.object.value,
    hasAccessNeedGroup: getOneMatchingQuad(dataset, node, INTEROP.hasAccessNeedGroup)?.object.value,
  }
  if (!reciprocal) {
    const reciprocalIri = getOneMatchingQuad(dataset, node, INTEROP.reciprocalRegistration)?.object
      .value
    if (reciprocalIri) {
      data.reciprocalRegistration = await factory.crud.socialAgentRegistration(
        reciprocalIri,
        true
      )
    }
  }
  return data
}

// ──────────────────────────
// Write path: SocialAgentRegistrationData → Dataset
// ──────────────────────────

export async function toDataset(data: SocialAgentRegistrationData): Promise<Store> {
  const store = await registrationToDataset(data)
  const node = DataFactory.namedNode(data.id)
  store.add(DataFactory.quad(node, SKOS.prefLabel, DataFactory.literal(data.prefLabel)))
  if (data.note) {
    store.add(DataFactory.quad(node, SKOS.note, DataFactory.literal(data.note)))
  }
  if (data.hasAccessNeedGroup) {
    store.add(
      DataFactory.quad(node, INTEROP.hasAccessNeedGroup, DataFactory.namedNode(data.hasAccessNeedGroup))
    )
  }
  return store
}

export async function createSocialAgentRegistration(
  data: SocialAgentRegistrationData,
  factory: AuthorizationAgentFactory
): Promise<void> {
  const dataset = await toDataset(data)
  dataset.add(
    DataFactory.quad(DataFactory.namedNode(data.id), RDF.type, INTEROP.SocialAgentRegistration)
  )
  const container = new CRUDContainer(data.id, factory, {})
  container.dataset = dataset
  await container.create()
}

// ──────────────────────────
// Behavior functions (replacing class methods)
// ──────────────────────────

export async function discoverReciprocal(
  data: SocialAgentRegistrationData,
  factory: AuthorizationAgentFactory,
  fetch: WhatwgFetch
): Promise<string | null> {
  const authrizationAgentIri = await discoverAuthorizationAgent(data.registeredAgent, factory.fetch)
  if (!authrizationAgentIri) return null
  return discoverAgentRegistration(authrizationAgentIri, fetch)
}

async function updateReciprocal(
  data: SocialAgentRegistrationData,
  factory: AuthorizationAgentFactory,
  reciprocalRegistrationIri: string
): Promise<void> {
  const node = DataFactory.namedNode(data.id)
  const quad = DataFactory.quad(node, INTEROP.reciprocalRegistration, DataFactory.namedNode(reciprocalRegistrationIri))
  if (data.reciprocalRegistration) {
    const priorQuad = DataFactory.quad(
      node,
      INTEROP.reciprocalRegistration,
      DataFactory.namedNode(data.reciprocalRegistration.id)
    )
    await replaceStatement(data.id, factory, priorQuad, quad)
  } else {
    await addStatement(data.id, factory, quad)
  }
  data.reciprocalRegistration = await factory.crud.socialAgentRegistration(
    reciprocalRegistrationIri,
    true
  )
}

export async function discoverAndUpdateReciprocal(
  data: SocialAgentRegistrationData,
  factory: AuthorizationAgentFactory,
  fetch: WhatwgFetch
): Promise<void> {
  const reciprocalRegistrationIri = await discoverReciprocal(data, factory, fetch)
  if (reciprocalRegistrationIri) {
    await updateReciprocal(data, factory, reciprocalRegistrationIri)
  }
}

export async function setAccessNeedGroup(
  data: SocialAgentRegistrationData,
  factory: AuthorizationAgentFactory,
  accessNeedGroupIri: string
): Promise<void> {
  const node = DataFactory.namedNode(data.id)
  const quad = DataFactory.quad(node, INTEROP.hasAccessNeedGroup, DataFactory.namedNode(accessNeedGroupIri))
  if (data.hasAccessNeedGroup) {
    const priorQuad = DataFactory.quad(
      node,
      INTEROP.hasAccessNeedGroup,
      DataFactory.namedNode(data.hasAccessNeedGroup)
    )
    await replaceStatement(data.id, factory, priorQuad, quad)
  } else {
    await addStatement(data.id, factory, quad)
  }
  data.hasAccessNeedGroup = accessNeedGroupIri
}
