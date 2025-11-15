import { AuthorizationAgent } from '@janeirodigital/interop-authorization-agent'
import {
  BasicRepresentation,
  OkResponseDescription,
  OperationHttpHandler,
  addHeader,
} from '@solid/community-server'
import type {
  CredentialsExtractor,
  OperationHttpHandlerInput,
  ResponseDescription,
} from '@solid/community-server'
import { createVocabulary } from 'rdf-vocabulary'
import type { SessionManager } from './SessionManager'

const INTEROP = createVocabulary('http://www.w3.org/ns/solid/interop#', 'registeredAgent')

export class AgentIdHandler extends OperationHttpHandler {
  public constructor(
    private readonly credentialsExtractor: CredentialsExtractor,
    private readonly sessionManager: SessionManager
  ) {
    super()
  }
  public async handle({
    operation,
    request,
    response,
  }: OperationHttpHandlerInput): Promise<ResponseDescription> {
    const credentials = await this.credentialsExtractor.handleSafe(request)
    if (!credentials.agent) {
      const doc = JSON.stringify({ credentials })
      const representation = new BasicRepresentation(doc, operation.target, 'application/json')
      return new OkResponseDescription(representation.metadata, representation.data)
    }

    const regex = /[^/]+$/
    const agentId = operation.target.path
    const webId = Buffer.from(agentId.match(regex)[0], 'base64url').toString('utf8')

    const sai = await this.sessionManager.getSession(webId)
    let info
    if (sai.webId === credentials.agent.webId) {
      const registration = await sai.findApplicationRegistration(credentials.client.clientId)
      info = {
        agent: credentials.client.clientId,
        registration: registration?.iri,
      }
    } else {
      info = {
        agent: credentials.agent.webId,
        registration: (await sai.findSocialAgentRegistration(credentials.agent.webId))?.iri,
      }
    }
    const doc = JSON.stringify({ credentials, info })

    // TODO: ld+json
    const representation = new BasicRepresentation(doc, operation.target, 'application/json')
    if (info) {
      const link = `<${info.agent}>; anchor="${info.registration}"; rel="${INTEROP.registeredAgent}"`
      addHeader(response, 'Link', link)
    }
    return new OkResponseDescription(representation.metadata, representation.data)
  }
}
