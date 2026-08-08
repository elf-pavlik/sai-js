import { INTEROP, RDF, discoverAuthorizationAgent } from '@janeirodigital/interop-utils'
import { DataFactory, Store } from 'n3'
import type { AuthorizationAgentFactory } from '..'
import {
  type ApplicationRegistrationData,
  createApplicationRegistration,
  loadApplicationRegistration,
} from '../application-registration'
import { type AgentRegistrationData, setAcr } from './agent-registration'
import { addStatement, createContainer, iriForContained as containerIriForContained } from './container'
import { linkedIrisJsonLd } from '../jsonld-utils'
import {
  type SocialAgentInvitationData,
  loadSocialAgentInvitation,
  putSocialAgentInvitation,
} from './social-agent-invitation'
import {
  type SocialAgentRegistrationData,
  createSocialAgentRegistration,
  loadSocialAgentRegistration,
} from './social-agent-registration'

// ──────────────────────────
// Types
// ──────────────────────────

export type AgentRegistryData = {
  id: string
}

// ──────────────────────────
// Behavior functions (replacing class methods)
// ──────────────────────────

export async function* applicationRegistrations(
  data: AgentRegistryData,
  factory: AuthorizationAgentFactory
): AsyncIterable<ApplicationRegistrationData> {
  const iris = await linkedIrisJsonLd(data.id, factory.fetch.raw, 'hasApplicationRegistration')
  for (const iri of iris) {
    yield loadApplicationRegistration(iri, factory.fetch.raw)
  }
}

export async function* socialAgentRegistrations(
  data: AgentRegistryData,
  factory: AuthorizationAgentFactory
): AsyncIterable<SocialAgentRegistrationData> {
  const iris = await linkedIrisJsonLd(data.id, factory.fetch.raw, 'hasSocialAgentRegistration')
  for (const iri of iris) {
    yield loadSocialAgentRegistration(iri, factory.fetch.raw)
  }
}

export async function* socialAgentInvitations(
  data: AgentRegistryData,
  factory: AuthorizationAgentFactory
): AsyncIterable<SocialAgentInvitationData> {
  const iris = await linkedIrisJsonLd(data.id, factory.fetch.raw, 'hasSocialAgentInvitation')
  for (const iri of iris) {
    yield loadSocialAgentInvitation(iri, factory.fetch.raw)
  }
}

export async function findApplicationRegistration(
  data: AgentRegistryData,
  factory: AuthorizationAgentFactory,
  registeredAgent: string
): Promise<ApplicationRegistrationData | undefined> {
  for await (const registration of applicationRegistrations(data, factory)) {
    if (registration.registeredAgent === registeredAgent) {
      return registration
    }
  }
}

export async function findSocialAgentRegistration(
  data: AgentRegistryData,
  factory: AuthorizationAgentFactory,
  registeredAgent: string
): Promise<SocialAgentRegistrationData | undefined> {
  for await (const registration of socialAgentRegistrations(data, factory)) {
    if (registration.registeredAgent === registeredAgent) {
      return registration
    }
  }
}

export async function findSocialAgentInvitation(
  data: AgentRegistryData,
  factory: AuthorizationAgentFactory,
  capabilityUrl: string
): Promise<SocialAgentInvitationData | undefined> {
  for await (const invitation of socialAgentInvitations(data, factory)) {
    if (invitation.capabilityUrl === capabilityUrl) {
      return invitation
    }
  }
}

export async function findRegistration(
  data: AgentRegistryData,
  factory: AuthorizationAgentFactory,
  iri: string
): Promise<ApplicationRegistrationData | SocialAgentRegistrationData | undefined> {
  return (
    (await findApplicationRegistration(data, factory, iri)) ||
    findSocialAgentRegistration(data, factory, iri)
  )
}

export async function addApplicationRegistration(
  data: AgentRegistryData,
  factory: AuthorizationAgentFactory,
  registeredAgent: string
): Promise<ApplicationRegistrationData> {
  const existing = await findApplicationRegistration(data, factory, registeredAgent)
  if (existing) {
    throw new Error(`Application Registration for ${registeredAgent} already exists`)
  }
  const iri = iriForContained(data, factory, true)
  const registration = await factory.crud.applicationRegistration(iri, {
    registeredAgent,
  })
  await createApplicationRegistration(registration, factory)
  // link to created application registration
  const quad = DataFactory.quad(
    DataFactory.namedNode(data.id),
    INTEROP.hasApplicationRegistration,
    DataFactory.namedNode(registration.id)
  )
  await addStatement(data.id, factory, quad)
  await setAcr(
    registration,
    factory,
    {
      agent: factory.webId,
      client: factory.agentId,
    },
    {
      agent: factory.webId,
      client: registeredAgent,
    }
  )
  return registration
}

export async function addSocialAgentRegistration(
  data: AgentRegistryData,
  factory: AuthorizationAgentFactory,
  registeredAgent: string,
  prefLabel: string,
  note?: string
): Promise<SocialAgentRegistrationData> {
  const existing = await findSocialAgentRegistration(data, factory, registeredAgent)
  if (existing) {
    throw new Error(`Social Agent Registration for ${registeredAgent} already exists`)
  }
  const iri = iriForContained(data, factory, true)
  const registration = await factory.crud.socialAgentRegistration(iri, {
    registeredAgent,
    prefLabel,
    note,
    type: [INTEROP.SocialAgentRegistration.value],
  })
  await createSocialAgentRegistration(registration, factory)
  // link to created social agent registration
  const quad = DataFactory.quad(
    DataFactory.namedNode(data.id),
    INTEROP.hasSocialAgentRegistration,
    DataFactory.namedNode(registration.id)
  )
  await addStatement(data.id, factory, quad)
  const peerUas = await discoverAuthorizationAgent(registeredAgent, factory.fetch)
  await setAcr(
    registration,
    factory,
    {
      agent: factory.webId,
      client: factory.agentId,
    },
    {
      agent: registeredAgent,
      client: peerUas,
    }
  )
  return registration
}

export async function addSocialAgentInvitation(
  data: AgentRegistryData,
  factory: AuthorizationAgentFactory,
  capabilityUrl: string,
  prefLabel: string,
  note?: string
): Promise<SocialAgentInvitationData> {
  const existing = await findSocialAgentInvitation(data, factory, capabilityUrl)
  if (existing) {
    throw new Error(`Social Agent Invitation with ${capabilityUrl} already exists`)
  }
  const iri = iriForContained(data, factory)
  const invitation = await factory.crud.socialAgentInvitation(iri, {
    capabilityUrl,
    prefLabel,
    note,
    type: [INTEROP.SocialAgentInvitation.value],
  })
  await putSocialAgentInvitation(invitation, factory.fetch.raw)
  // link to created social agent invitation
  const quad = DataFactory.quad(
    DataFactory.namedNode(data.id),
    INTEROP.hasSocialAgentInvitation,
    DataFactory.namedNode(invitation.id)
  )
  await addStatement(data.id, factory, quad)
  return invitation
}

export async function createAgentRegistry(
  data: AgentRegistryData,
  factory: AuthorizationAgentFactory
): Promise<void> {
  const dataset = new Store()
  dataset.add(DataFactory.quad(DataFactory.namedNode(data.id), RDF.type, INTEROP.AgentRegistry))
  await createContainer(data.id, factory, dataset)
}

export function iriForContained(
  data: AgentRegistryData,
  factory: AuthorizationAgentFactory,
  container = false
): string {
  return containerIriForContained(data.id, factory, container)
}
