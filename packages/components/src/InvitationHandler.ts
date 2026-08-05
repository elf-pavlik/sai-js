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
import {
  AgentRegistry,
  setRegisteredAgent,
} from '@janeirodigital/interop-data-model'
import type { CustomWebIdStore } from './CustomWebIdStore.js'
import type { SessionManager } from './SessionManager'
import { Temporal } from './temporal/client.js'
import { establishReciprocal } from './temporal/workflows/reciprocal.js'

export class InvitationHandler extends OperationHttpHandler {
  protected readonly logger = getLoggerFor(this)
  public constructor(
    private readonly credentialsExtractor: CredentialsExtractor,
    private readonly sessionManager: SessionManager,
    private readonly webIdStore: CustomWebIdStore
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
        invitedId,
        socialAgentInvitation.prefLabel,
        socialAgentInvitation.note
      )
      // start workflow to discover, add and subscribe to reciprocal registration
      // delay it to make sure the other agent creates it after response from this handler
      const accountId = await this.webIdStore.findAccout(inviteeId)
      if (!accountId) {
        throw new Error(`accountId not found (inviteeId: ${inviteeId})`)
      }
      const temporal = new Temporal()
      await temporal.init()
      await temporal.client.workflow.start(establishReciprocal, {
        taskQueue: 'reciprocal-registration',
        args: [
          {
            accountId,
            webId: inviteeId,
            peerId: invitedId,
            registrationId: socialAgentRegistration.id,
          },
        ],
        startDelay: '10s',
        workflowId: crypto.randomUUID(),
      })
    }

    // update invitation with agent who accepted it
    await setRegisteredAgent(
      socialAgentInvitation,
      sai.factory,
      socialAgentRegistration.registeredAgent
    )

    const representation = new BasicRepresentation(inviteeId, operation.target, 'text/plain')
    return new OkResponseDescription(representation.metadata, representation.data)
  }
}
