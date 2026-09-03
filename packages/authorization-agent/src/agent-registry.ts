import {
  type ApplicationRegistryData,
  type ApplicationRegistrationData,
  type InvitationRegistryData,
  type SocialAgentInvitationData,
  type SocialAgentRegistrationData,
  type SocialAgentRegistryData,
  loadApplicationRegistration,
  loadSocialAgentInvitation,
  loadSocialAgentRegistration,
} from '@janeirodigital/interop-data-model'
import type { AgentAndClient } from '@janeirodigital/interop-data-model'
import type { DataModelDependencies } from './types'
import {
  INTEROP,
  LDP,
  type WhatwgFetch,
  discoverAuthorizationAgent,
  iriForContained,
  linkedIrisJsonLd,
} from '@janeirodigital/interop-utils'
import { setAcr } from './agent-registration'
import { createApplicationRegistration } from './application-registration'
import { putSocialAgentInvitation } from './social-agent-invitation'
import { createSocialAgentRegistration } from './social-agent-registration'

// ──────────────────────────
// Behavior functions (replacing class methods)
// ──────────────────────────

/**
 * Children of a dedicated registry container — its `ldp:contains` listing,
 * server-managed (the container's own graph, included in container GET
 * representations by `DataAccessorBasedStore`). The ownership predicates
 * (`interop:hasSocialAgentRegistration` / `hasApplicationRegistration` /
 * `hasSocialAgentInvitation`) are gone: containment is the single source of
 * membership for the three dedicated registries.
 */
async function containedIris(
  registry: { id: string },
  fetch: WhatwgFetch
): Promise<string[]> {
  return linkedIrisJsonLd(registry.id, fetch, LDP.contains)
}

export async function* applicationRegistrations(
  data: ApplicationRegistryData,
  fetch: WhatwgFetch
): AsyncIterable<ApplicationRegistrationData> {
  const iris = await containedIris(data, fetch)
  for (const iri of iris) {
    yield loadApplicationRegistration(iri, fetch)
  }
}

export async function* socialAgentRegistrations(
  data: SocialAgentRegistryData,
  fetch: WhatwgFetch
): AsyncIterable<SocialAgentRegistrationData> {
  const iris = await containedIris(data, fetch)
  for (const iri of iris) {
    yield loadSocialAgentRegistration(iri, fetch)
  }
}

export async function* socialAgentInvitations(
  data: InvitationRegistryData,
  fetch: WhatwgFetch
): AsyncIterable<SocialAgentInvitationData> {
  const iris = await containedIris(data, fetch)
  for (const iri of iris) {
    yield loadSocialAgentInvitation(iri, fetch)
  }
}

export async function findApplicationRegistration(
  data: ApplicationRegistryData,
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
  data: SocialAgentRegistryData,
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
  data: InvitationRegistryData,
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
  socialAgentRegistry: SocialAgentRegistryData,
  applicationRegistry: ApplicationRegistryData,
  fetch: WhatwgFetch,
  id: string
): Promise<ApplicationRegistrationData | SocialAgentRegistrationData | undefined> {
  return (
    (await findApplicationRegistration(applicationRegistry, fetch, id)) ||
    findSocialAgentRegistration(socialAgentRegistry, fetch, id)
  )
}

export async function addApplicationRegistration(
  data: ApplicationRegistryData,
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
  // containment is server-managed — no container PATCH needed
  await setAcr(registration, deps.fetch, creator, {
    agent: creator.agent,
    client: registeredAgent,
  })
  return registration
}

export async function addSocialAgentRegistration(
  data: SocialAgentRegistryData,
  deps: DataModelDependencies,
  creator: AgentAndClient,
  registeredAgent: string,
  label: string,
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
    label,
    note,
    hasDataGrant: [],
    hasAdminGrant: [],
  }
  await createSocialAgentRegistration(registration, deps.fetch)
  // containment is server-managed — no container PATCH needed
  const peerUas = await discoverAuthorizationAgent(registeredAgent, deps.fetch)
  await setAcr(registration, deps.fetch, creator, {
    agent: registeredAgent,
    client: peerUas,
  })
  return registration
}

export async function addSocialAgentInvitation(
  data: InvitationRegistryData,
  deps: DataModelDependencies,
  capabilityUrl: string,
  label: string,
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
    label,
    note,
  }
  await putSocialAgentInvitation(invitation, deps.fetch)
  // containment is server-managed — no container PATCH needed
  return invitation
}