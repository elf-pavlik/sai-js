import {
  BasicRepresentation,
  OkResponseDescription,
  OperationHttpHandler,
  addHeader,
} from '@solid/community-server'
import type {
  CredentialsExtractor,
  InteractionRoute,
  OperationHttpHandlerInput,
  ResponseDescription,
} from '@solid/community-server'
import { getLoggerFor } from 'global-logger-factory'
import {
  getAdminGrantIris,
  type SocialAgentRegistrationData,
} from '@janeirodigital/interop-data-model'
import type { SessionManager } from './SessionManager'
import { INTEROP } from './vocabularies.js'

export class AgentIdHandler extends OperationHttpHandler {
  protected readonly logger = getLoggerFor(this)
  public constructor(
    private readonly credentialsExtractor: CredentialsExtractor,
    private readonly sessionManager: SessionManager,
    private readonly authorizationEndpoint: InteractionRoute,
    private readonly delegationEndpoint: InteractionRoute
  ) {
    super()
  }
  public async handle({
    operation,
    request,
    response,
  }: OperationHttpHandlerInput): Promise<ResponseDescription> {
    const agentId = operation.target.path
    const client = {
      '@context': [
        'https://www.w3.org/ns/solid/oidc-context.jsonld',
        'https://www.w3.org/ns/solid/notifications-context/v1',
        {
          interop: 'http://www.w3.org/ns/solid/interop#',
        },
      ],
      client_id: agentId,
      'interop:hasAuthorizationRedirectEndpoint': this.authorizationEndpoint.getPath(),
      'interop:hasDelegationIssuanceEndpoint': this.delegationEndpoint.getPath(),
    }

    const credentials = await this.credentialsExtractor.handleSafe(request)
    if (credentials.agent) {
      const regex = /[^/]+$/
      const webId = Buffer.from(agentId.match(regex)[0], 'base64url').toString('utf8')

      const sai = await this.sessionManager.getSession(webId)
      const isOwner = sai.webId === credentials.agent.webId
      const registration = isOwner
        ? await sai.findApplicationRegistration(credentials.client.clientId)
        : await sai.findSocialAgentRegistration(credentials.agent.webId)

      if (registration) {
        const info = {
          agent: credentials.client.clientId,
          registration: registration.id,
        }
        const link = `<${info.agent}>; anchor="${info.registration}"; rel="${INTEROP.registeredAgent}"`
        addHeader(response, 'Link', link)

        // phase-2 org context: an admin of the org gets a second link exposing
        // the org's RegistrySet IRI (only when requesting a doc that is not
        // their own — the social-agent branch above). The header is
        // evaluated against request credentials, so the admin-only link stays
        // private while the body remains public.
        if (!isOwner) {
          const adminGrantIris = await getAdminGrantIris(
            registration as SocialAgentRegistrationData
          )
          if (adminGrantIris.length > 0) {
            addHeader(response, 'Link', `<${sai.registrySet.id}>; rel="${INTEROP.hasRegistrySet}"`)
          }
        }
      }
    }

    const representation = new BasicRepresentation(
      JSON.stringify(client),
      operation.target,
      'application/ld+json'
    )
    return new OkResponseDescription(representation.metadata, representation.data)
  }
}
