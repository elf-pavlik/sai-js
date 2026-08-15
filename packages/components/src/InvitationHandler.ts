import { ActivityRegistry, AgentRegistry, setRegisteredAgent } from '@janeirodigital/interop-data-model'
import {
  BasicRepresentation,
  ForbiddenHttpError,
  OkResponseDescription,
  OperationHttpHandler,
} from '@solid/community-server'
import type {
  CredentialsExtractor,
  OperationHttpHandlerInput,
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
        sai.registrySet.hasAgentRegistry,
        sai.factory,
        { agent: sai.webId, client: sai.agentId },
        invitedId,
        socialAgentInvitation.prefLabel,
        socialAgentInvitation.note
      )
      // write the agentRegistrationAdded activity → the main agent's webhook
      // handler starts establishReciprocal (retry policy replaces the old
      // startDelay hack — §6.7)
      const activityRegistry = sai.registrySet.hasActivityRegistry
      if (!activityRegistry) throw new Error('activity registry not found in registry set')
      await ActivityRegistry.createActivity(activityRegistry, sai.factory, {
        activityType: 'agentRegistrationAdded',
        target: socialAgentRegistration.id,
        payload: {
          webId: inviteeId,
          peerId: invitedId,
          registrationId: socialAgentRegistration.id,
        },
        status: 'pending',
        createdAt: new Date().toISOString(),
      })
    }

    // update invitation with agent who accepted it
    await setRegisteredAgent(
      socialAgentInvitation,
      sai.factory.fetch,
      socialAgentRegistration.registeredAgent
    )

    const representation = new BasicRepresentation(inviteeId, operation.target, 'text/plain')
    return new OkResponseDescription(representation.metadata, representation.data)
  }
}
