import { AuthorizationAgent } from '@janeirodigital/interop-authorization-agent'
import {
  BasicRepresentation,
  OkResponseDescription,
  OperationHttpHandler,
  addHeader,
} from '@solid/community-server'
import type {
  CredentialsExtractor,
  JwkGenerator,
  OperationHttpHandlerInput,
  ResponseDescription,
} from '@solid/community-server'
import { generateKeyPair } from 'jose'
import { createVocabulary } from 'rdf-vocabulary'
import { SelfIssuedSession } from './SelfIssuedSession.js'

const INTEROP = createVocabulary('http://www.w3.org/ns/solid/interop#', 'registeredAgent')

export class AgentIdHandler extends OperationHttpHandler {
  private readonly issuer: string
  public constructor(
    baseUrl: string,
    private readonly credentialsExtractor: CredentialsExtractor,
    private readonly jwkGenerator: JwkGenerator,
    private readonly expiration: number
  ) {
    super()
    this.issuer = baseUrl
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

    const privateKey = await this.jwkGenerator.getPrivateKey()
    const publicKey = await this.jwkGenerator.getPublicKey()

    const regex = /[^/]+$/
    const agentId = operation.target.path
    const webid = Buffer.from(agentId.match(regex)[0], 'base64url').toString('utf8')
    const dpopKeyPair = await generateKeyPair('ES256')

    const oidc = new SelfIssuedSession({
      webid,
      clientId: agentId,
      issuer: this.issuer,
      expiresIn: this.expiration * 60 * 1000,
      privateKey,
      publicKey,
      dpopKeyPair,
    })
    await oidc.login()

    const sai = await AuthorizationAgent.build(webid, agentId, {
      fetch: oidc.authFetch.bind(oidc),
      randomUUID: crypto.randomUUID,
    })
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
