import {
  ActivityRegistry,
  AgentRegistry,
  setRegisteredAgent,
} from '@janeirodigital/interop-authorization-agent'
import type { AgentRegistrationAdded } from '@janeirodigital/interop-data-model'
import { INTEROP } from '@janeirodigital/interop-utils'
import {
  BasicRepresentation,
  ForbiddenHttpError,
  OkResponseDescription,
  OperationHttpHandler,
} from '@solid/community-server'
import type {
  OperationHttpHandlerInput,
  CredentialsExtractor,
  ResponseDescription,
} from '@solid/community-server'
import { getLoggerFor } from 'global-logger-factory'
import type { SessionManager } from './SessionManager'

export class InvitationHandler extends OperationHttpHandler {
  protected readonly logger = getLoggerFor(this)
  public constructor(
    private readonly credentialsExtractor: CredentialsExtractor,
    private readonly sessionManager: SessionManager
  ) {
    super()
  }
  public async handle({
    operation,
    request,
  }: OperationHttpHandlerInput): Promise<ResponseDescription> {
    const credentials = await this.credentialsExtractor.handleSafe(request)
    // TODO: check clientId if authorization agent
    if (!credentials.agent?.webId) {
      throw new ForbiddenHttpError()
    }
    const capabilityUrl = operation.target.path
    const invitedId = credentials.agent.webId
    const regex = /[^/]+$/
    const encoded = capabilityUrl.match(regex)[0].split('.')[0]
    const inviteeId = Buffer.from(encoded, 'base64url').toString('utf8')
    const sai = await this.sessionManager.getSession(inviteeId)

    const socialAgentInvitation = await sai.findSocialAgentInvitation(capabilityUrl)
    if (!socialAgentInvitation) {
      throw new Error(`Social Agent Invitation not found! (capabilityUrl: ${capabilityUrl})`)
    }

    let socialAgentRegistration = await sai.findSocialAgentRegistration(invitedId)
    if (!socialAgentRegistration) {
      socialAgentRegistration = await AgentRegistry.addSocialAgentRegistration(
        sai.registrySet.hasSocialAgentRegistry,
        { fetch: sai.fetch, randomUUID: sai.randomUUID },
        { agent: sai.webId, client: sai.agentId },
        invitedId,
        socialAgentInvitation.prefLabel,
        socialAgentInvitation.note
      )
      // write the agentRegistrationAdded activity → the main agent's webhook
      // handler starts establishReciprocal (retry policy replaces the old
      // startDelay hack — §6.7) — urn:uuid snapshot of the registration
      // (`registeredAgent` — the peer; same-doc embed, never dereferenced)
      const activityRegistry = sai.registrySet.hasActivityRegistry
      if (!activityRegistry) throw new Error('activity registry not found in registry set')
      const activity: Omit<AgentRegistrationAdded, 'id'> = {
        type: ['Activity', 'AgentRegistrationAdded', 'as:Add'],
        actor: sai.webId,
        target: socialAgentRegistration.id,
        object: {
          id: `urn:uuid:${sai.randomUUID()}`,
          type: [INTEROP.SocialAgentRegistration],
          registeredAgent: invitedId,
          prefLabel: socialAgentInvitation.prefLabel,
          note: socialAgentInvitation.note,
        },
        createdAt: new Date().toISOString(),
      }
      await ActivityRegistry.createActivity(
        activityRegistry,
        { fetch: sai.fetch, randomUUID: sai.randomUUID },
        activity
      )
    }

    // update invitation with agent who accepted it
    await setRegisteredAgent(
      socialAgentInvitation,
      sai.fetch,
      socialAgentRegistration.registeredAgent
    )

    const representation = new BasicRepresentation(inviteeId, operation.target, 'text/plain')
    return new OkResponseDescription(representation.metadata, representation.data)
  }
}
