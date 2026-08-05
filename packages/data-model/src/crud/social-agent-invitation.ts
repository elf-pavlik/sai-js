import { INTEROP, SKOS, getOneMatchingQuad } from '@janeirodigital/interop-utils'
import { DataFactory, Store } from 'n3'
import type { AuthorizationAgentFactory } from '..'
import { CRUDResource } from './resource'
import { fetchDataset } from './resource'

// ──────────────────────────
// Types
// ──────────────────────────

export type SocialAgentInvitationData = {
  id: string
  capabilityUrl: string
  prefLabel: string
  note?: string
  registeredAgent?: string
}

// ──────────────────────────
// Read path: Dataset → SocialAgentInvitationData
// ──────────────────────────

export async function loadSocialAgentInvitation(
  iri: string,
  factory: AuthorizationAgentFactory
): Promise<SocialAgentInvitationData> {
  const dataset = await fetchDataset(iri, factory)
  const node = DataFactory.namedNode(iri)
  return {
    id: iri,
    capabilityUrl: getOneMatchingQuad(dataset, node, INTEROP.hasCapabilityUrl)?.object.value ?? '',
    prefLabel: getOneMatchingQuad(dataset, node, SKOS.prefLabel)?.object.value ?? '',
    note: getOneMatchingQuad(dataset, node, SKOS.note)?.object.value,
    registeredAgent: getOneMatchingQuad(dataset, node, INTEROP.registeredAgent)?.object.value,
  }
}

// ──────────────────────────
// Write path: SocialAgentInvitationData → Dataset
// ──────────────────────────

export async function toDataset(data: SocialAgentInvitationData): Promise<Store> {
  const store = new Store()
  const node = DataFactory.namedNode(data.id)
  store.add(DataFactory.quad(node, INTEROP.hasCapabilityUrl, DataFactory.literal(data.capabilityUrl)))
  store.add(DataFactory.quad(node, SKOS.prefLabel, DataFactory.literal(data.prefLabel)))
  if (data.note) {
    store.add(DataFactory.quad(node, SKOS.note, DataFactory.literal(data.note)))
  }
  if (data.registeredAgent) {
    store.add(
      DataFactory.quad(node, INTEROP.registeredAgent, DataFactory.namedNode(data.registeredAgent))
    )
  }
  return store
}

export async function updateSocialAgentInvitation(
  data: SocialAgentInvitationData,
  factory: AuthorizationAgentFactory
): Promise<void> {
  const dataset = await toDataset(data)
  const resource = new CRUDResource(data.id, factory, data)
  resource.dataset = dataset
  await resource.update()
}

// ──────────────────────────
// Behavior functions (replacing class methods)
// ──────────────────────────

export async function setRegisteredAgent(
  data: SocialAgentInvitationData,
  factory: AuthorizationAgentFactory,
  webId: string
): Promise<void> {
  data.registeredAgent = webId
  await updateSocialAgentInvitation(data, factory)
}
