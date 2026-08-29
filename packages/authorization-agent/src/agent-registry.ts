import {
  type AgentRegistryData,
  type ApplicationRegistrationData,
  type DataModelDependencies,
  type SocialAgentInvitationData,
  type SocialAgentRegistrationData,
  loadApplicationRegistration,
  loadSocialAgentInvitation,
  loadSocialAgentRegistration,
} from '@janeirodigital/interop-data-model'
import type { AgentAndClient } from '@janeirodigital/interop-data-model'
import {
  INTEROP,
  type WhatwgFetch,
  addStatement,
  discoverAuthorizationAgent,
  iriForContained,
  linkedIrisJsonLd,
} from '@janeirodigital/interop-utils'
import { DataFactory } from 'n3'
import { setAcr } from './agent-registration'
import { createApplicationRegistration } from './application-registration'
import { putSocialAgentInvitation } from './social-agent-invitation'
import { createSocialAgentRegistration } from './social-agent-registration'

// ──────────────────────────
// Behavior functions (replacing class methods)
// ──────────────────────────

export async function* applicationRegistrations(
  data: AgentRegistryData,
  fetch: WhatwgFetch
): AsyncIterable<ApplicationRegistrationData> {
  const iris = await linkedIrisJsonLd(data.id, fetch, INTEROP.hasApplicationRegistration)
  for (const iri of iris) {
    yield loadApplicationRegistration(iri, fetch)
  }
}

export async function* socialAgentRegistrations(
  data: AgentRegistryData,
  fetch: WhatwgFetch
): AsyncIterable<SocialAgentRegistrationData> {
  const iris = await linkedIrisJsonLd(data.id, fetch, INTEROP.hasSocialAgentRegistration)
  for (const iri of iris) {
    yield loadSocialAgentRegistration(iri, fetch)
  }
}

export async function* socialAgentInvitations(
  data: AgentRegistryData,
  fetch: WhatwgFetch
): AsyncIterable<SocialAgentInvitationData> {
  const iris = await linkedIrisJsonLd(data.id, fetch, INTEROP.hasSocialAgentInvitation)
  for (const iri of iris) {
    yield loadSocialAgentInvitation(iri, fetch)
  }
}

export async function findApplicationRegistration(
  data: AgentRegistryData,
  fetch: WhatwgFetch,
  registeredAgent: string
): Promise<ApplicationRegistrationData | undefined> {
  for await (const registration of applicationRegistrations(data, fetch)) {
    if (registration.registeredAgent === registeredAgent) {
      return registration
    }
  }
}

export async function findSocialAgentRegistration(
  data: AgentRegistryData,
  fetch: WhatwgFetch,
  registeredAgent: string
): Promise<SocialAgentRegistrationData | undefined> {
  for await (const registration of socialAgentRegistrations(data, fetch)) {
    if (registration.registeredAgent === registeredAgent) {
      return registration
    }
  }
}

export async function findSocialAgentInvitation(
  data: AgentRegistryData,
  fetch: WhatwgFetch,
  capabilityUrl: string
): Promise<SocialAgentInvitationData | undefined> {
  for await (const invitation of socialAgentInvitations(data, fetch)) {
    if (invitation.capabilityUrl === capabilityUrl) {
      return invitation
    }
  }
}

export async function findRegistration(
  data: AgentRegistryData,
  fetch: WhatwgFetch,
  id: string
): Promise<ApplicationRegistrationData | SocialAgentRegistrationData | undefined> {
  return (
    (await findApplicationRegistration(data, fetch, id)) ||
    findSocialAgentRegistration(data, fetch, id)
  )
}

export async function addApplicationRegistration(
  data: AgentRegistryData,
  deps: DataModelDependencies,
  creator: AgentAndClient,
  registeredAgent: string
): Promise<ApplicationRegistrationData> {
  const existing = await findApplicationRegistration(data, deps.fetch, registeredAgent)
  if (existing) {
    throw new Error(`Application Registration for ${registeredAgent} already exists`)
  }
  const iri = iriForContained(data, deps.randomUUID, true)
  const registration: ApplicationRegistrationData = {
    id: iri,
    type: [INTEROP.ApplicationRegistration],
    registeredAgent,
    hasDataGrant: [],
    granted: false,
  }
  await createApplicationRegistration(registration, deps.fetch)
  // link to created application registration
  const quad = DataFactory.quad(
    DataFactory.namedNode(data.id),
    INTEROP.terms.hasApplicationRegistration,
    DataFactory.namedNode(registration.id)
  )
  await addStatement(data.id, deps.fetch, quad)
  await setAcr(registration, deps.fetch, creator, {
    agent: creator.agent,
    client: registeredAgent,
  })
  return registration
}

export async function addSocialAgentRegistration(
  data: AgentRegistryData,
  deps: DataModelDependencies,
  creator: AgentAndClient,
  registeredAgent: string,
  prefLabel: string,
  note?: string
): Promise<SocialAgentRegistrationData> {
  const existing = await findSocialAgentRegistration(data, deps.fetch, registeredAgent)
  if (existing) {
    throw new Error(`Social Agent Registration for ${registeredAgent} already exists`)
  }
  const iri = iriForContained(data, deps.randomUUID, true)
  const registration: SocialAgentRegistrationData = {
    id: iri,
    type: [INTEROP.SocialAgentRegistration],
    registeredAgent,
    prefLabel,
    note,
    hasDataGrant: [],
    hasAdminGrant: [],
  }
  await createSocialAgentRegistration(registration, deps.fetch)
  // link to created social agent registration
  const quad = DataFactory.quad(
    DataFactory.namedNode(data.id),
    INTEROP.terms.hasSocialAgentRegistration,
    DataFactory.namedNode(registration.id)
  )
  await addStatement(data.id, deps.fetch, quad)
  const peerUas = await discoverAuthorizationAgent(registeredAgent, deps.fetch)
  await setAcr(registration, deps.fetch, creator, {
    agent: registeredAgent,
    client: peerUas,
  })
  return registration
}

export async function addSocialAgentInvitation(
  data: AgentRegistryData,
  deps: DataModelDependencies,
  capabilityUrl: string,
  prefLabel: string,
  note?: string
): Promise<SocialAgentInvitationData> {
  const existing = await findSocialAgentInvitation(data, deps.fetch, capabilityUrl)
  if (existing) {
    throw new Error(`Social Agent Invitation with ${capabilityUrl} already exists`)
  }
  const iri = iriForContained(data, deps.randomUUID)
  const invitation: SocialAgentInvitationData = {
    id: iri,
    type: [INTEROP.SocialAgentInvitation],
    capabilityUrl,
    prefLabel,
    note,
  }
  await putSocialAgentInvitation(invitation, deps.fetch)
  // link to created social agent invitation
  const quad = DataFactory.quad(
    DataFactory.namedNode(data.id),
    INTEROP.terms.hasSocialAgentInvitation,
    DataFactory.namedNode(invitation.id)
  )
  await addStatement(data.id, deps.fetch, quad)
  return invitation
}
