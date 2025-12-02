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
    if (!socialAgentInvitation)
      throw new Error(`Social Agent Invitation not found! (capabilityUrl: ${capabilityUrl})`)

    let socialAgentRegistration = await sai.findSocialAgentRegistration(invitedId)
    if (!socialAgentRegistration) {
      socialAgentRegistration = await sai.registrySet.hasAgentRegistry.addSocialAgentRegistration(
        invitedId,
        socialAgentInvitation.label,
        socialAgentInvitation.note
      )
      // create job to discover, add and subscribe to reciprocal registration
      // delay it to make sure the other agent creates it after response from this handler
    }

    // update invitation with agent who accepted it
    socialAgentInvitation.registeredAgent = socialAgentRegistration.registeredAgent
    await socialAgentInvitation.update()

    const representation = new BasicRepresentation(inviteeId, operation.target, 'text/plain')
    return new OkResponseDescription(representation.metadata, representation.data)
  }
}
