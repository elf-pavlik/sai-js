import type { AuthorizationAgent } from '@janeirodigital/interop-authorization-agent'
import {
  AgentRegistry,
  type ApplicationRegistrationData,
  type SocialAgentInvitationData,
  type SocialAgentRegistrationData,
  discoverAndUpdateReciprocal,
  getAdminGrantIris,
  getDataGrantIris,
  getDataGrants,
} from '@janeirodigital/interop-data-model'
import {
  Application,
  IRI,
  SocialAgent,
  SocialAgentInvitation,
  UnregisteredApplication,
} from '@janeirodigital/sai-api-messages'
import type * as S from 'effect/Schema'
import { invitationUrl } from '../util/uriTemplates.js'

/**
 * Build the UI profile of a social agent from its registration.
 *
 * `personal` selects which side carries the admin marker (§2.2 asymmetry of
 * org-admin-feature.md):
 * - `true` (personal context) — `registration` is OUR registration of the
 *   agent; the admin marker lives on the AGENT'S registration of us (reached
 *   via `reciprocalRegistration`, non-empty `hasAdminGrant`);
 * - `false` (org context) — `registration` is the ORG's registration of the
 *   agent; the admin marker is read directly from it.
 */
export const buildSocialAgentProfile = async (
  registration: SocialAgentRegistrationData,
  saiSession: AuthorizationAgent,
  personal = true
) => {
  let admin = false
  if (personal && registration.reciprocalRegistration) {
    const reciprocal = await saiSession.factory.socialAgentRegistration(
      registration.reciprocalRegistration
    )
    admin = (await getAdminGrantIris(reciprocal)).length > 0
  } else if (!personal) {
    admin = (await getAdminGrantIris(registration)).length > 0
  }

  // TODO (angel) data validation and how to handle when the social agents profile is missing some components?
  return SocialAgent.make({
    id: IRI.make(registration.registeredAgent),
    label: registration.prefLabel,
    note: registration.note,
    //authorizationDate: registration.registeredAt!.toISOString(),
    //lastUpdateDate: registration.updatedAt?.toISOString(),
    accessRequested: !!registration.hasAccessNeedGroup,
    admin,
    // the grantor-side registration's hasDataGrant: the grants WE issued to
    // this agent — first grant IRI; absent → the SocialAgentList warning badge
    accessGrant: (await getDataGrantIris(registration))[0],
    accessNeedGroup: registration.reciprocalRegistration
      ? (await saiSession.factory.socialAgentRegistration(registration.reciprocalRegistration))
          .hasAccessNeedGroup
      : undefined,
  })
}

export const getSocialAgents = async (saiSession: AuthorizationAgent, personal = true) => {
  const profiles = []
  for await (const registration of saiSession.socialAgentRegistrations) {
    profiles.push(await buildSocialAgentProfile(registration, saiSession, personal))
  }

  const seenIds = new Set(profiles.map((p) => p.id))
  for await (const registration of saiSession.socialAgentRegistrations) {
    if (!registration.reciprocalRegistration) continue
    const reciprocalReg = await saiSession.factory.socialAgentRegistration(
      registration.reciprocalRegistration
    )
    if ((await getDataGrantIris(reciprocalReg)).length === 0) continue
    const dataGrants = await getDataGrants(reciprocalReg, saiSession.factory)
    for (const dataGrant of dataGrants) {
      const ownerIri = IRI.make(dataGrant.dataOwner)
      if (seenIds.has(ownerIri)) continue
      seenIds.add(ownerIri)
      let label = dataGrant.dataOwner
      try {
        const profile = await saiSession.factory.webIdProfile(ownerIri)
        if (profile.label) label = profile.label
      } catch {
        /* fallback to IRI */
      }
      profiles.push(
        SocialAgent.make({
          id: ownerIri,
          label,
          accessRequested: false,
          // no registration in this registry — no admin marker can be read
          admin: false,
        })
      )
    }
  }

  return profiles
}

export const addSocialAgent = async (
  saiSession: AuthorizationAgent,
  data: { webId: string; label: string; note?: string }
) => {
  const existing = await saiSession.findSocialAgentRegistration(data.webId)
  if (existing) {
    // logger.error('SocialAgentRegistration already exists', { webId: data.webId })
    return buildSocialAgentProfile(existing, saiSession)
  }
  const registration = await AgentRegistry.addSocialAgentRegistration(
    saiSession.registrySet.hasAgentRegistry,
    saiSession.factory,
    { agent: saiSession.webId, client: saiSession.agentId },
    data.webId,
    data.label,
    data.note
  )

  return buildSocialAgentProfile(registration, saiSession)
}

const buildApplicationProfile = async (
  saiSession: AuthorizationAgent,
  registration: ApplicationRegistrationData
) => {
  // Design B: the registration resource is single-node — name/logo/accessNeedGroup/
  // callbackEndpoint come from the client ID document (the canonical source)
  const clientIdDocument = await saiSession.factory.clientIdDocument(registration.registeredAgent)
  // TODO (angel) data validation and how to handle when the applications profile is missing some components?
  return Application.make({
    id: IRI.make(registration.registeredAgent),
    name: clientIdDocument.clientName!,
    logo: clientIdDocument.logoUri,
    //authorizationDate: registration.registeredAt!.toISOString(),
    //lastUpdateDate: registration.updatedAt?.toISOString(),
    accessNeedGroup: clientIdDocument.hasAccessNeedGroup!,
    callbackEndpoint: clientIdDocument.callbackEndpoint,
  })
}
/**
 * Returns all the registered applications for the currently authenticated agent
 * @param saiSession
 */
export const getApplications = async (saiSession: AuthorizationAgent) => {
  const profiles = []
  for await (const registration of saiSession.applicationRegistrations) {
    profiles.push(await buildApplicationProfile(saiSession, registration))
  }
  return profiles
}

/**
 * Returns the application profile of an application that is _not_ registered for the given agent
 */
export const getUnregisteredApplication = async (agent: AuthorizationAgent, id: IRI) => {
  const { name, logo, accessNeedGroup } = await agent.factory.clientIdDocument(id).then((doc) => ({
    name: doc.clientName,
    logo: doc.logoUri,
    accessNeedGroup: doc.hasAccessNeedGroup,
  }))

  return UnregisteredApplication.make({ id: IRI.make(id), name, logo, accessNeedGroup })
}

function buildSocialAgentInvitation(socialAgentInvitation: SocialAgentInvitationData) {
  return SocialAgentInvitation.make({
    id: IRI.make(socialAgentInvitation.id),
    capabilityUrl: socialAgentInvitation.capabilityUrl,
    label: socialAgentInvitation.prefLabel,
    note: socialAgentInvitation.note,
  })
}

export async function getSocialAgentInvitations(saiSession: AuthorizationAgent) {
  const invitations = []
  for await (const invitation of saiSession.socialAgentInvitations) {
    if (!invitation.registeredAgent) {
      invitations.push(buildSocialAgentInvitation(invitation))
    }
  }
  return invitations
}

export async function createInvitation(
  saiSession: AuthorizationAgent,
  base: { label: string; note?: string }
): Promise<S.Schema.Type<typeof SocialAgentInvitation>> {
  const id = invitationUrl(saiSession.webId)
  const socialAgentInvitation = await AgentRegistry.addSocialAgentInvitation(
    saiSession.registrySet.hasAgentRegistry,
    saiSession.factory,
    id,
    base.label,
    base.note
  )
  return buildSocialAgentInvitation(socialAgentInvitation)
}

export async function acceptInvitation(
  saiSession: AuthorizationAgent,
  invitation: { capabilityUrl: string; label: string; note?: string }
): Promise<S.Schema.Type<typeof SocialAgent>> {
  // discover who issued the invitation
  const response = await saiSession.fetch(invitation.capabilityUrl, {
    method: 'POST',
  })
  if (!response.ok) throw new Error('fetching capability url failed')
  const webId = (await response.text()).trim()
  // TODO: validate with regex
  if (!webId) throw new Error('can not accept invitation without webid')
  // check if agent already has registration
  let socialAgentRegistration = await saiSession.findSocialAgentRegistration(webId)
  if (!socialAgentRegistration) {
    // create new social agent registration
    socialAgentRegistration = await AgentRegistry.addSocialAgentRegistration(
      saiSession.registrySet.hasAgentRegistry,
      saiSession.factory,
      { agent: saiSession.webId, client: saiSession.agentId },
      webId,
      invitation.label,
      invitation.note
    )
  }
  // discover and add reciprocal
  if (!socialAgentRegistration.reciprocalRegistration) {
    discoverAndUpdateReciprocal(socialAgentRegistration, saiSession.factory, saiSession.fetch)
  }

  // currently api-handler creates job for reciprocal registration

  return buildSocialAgentProfile(socialAgentRegistration, saiSession)
}
