import {
  BadRequestHttpError,
  BasicRepresentation,
  ForbiddenHttpError,
  MethodNotAllowedHttpError,
  OkResponseDescription,
  OperationHttpHandler,
} from '@solid/community-server'
import type {
  CredentialsExtractor,
  OperationHttpHandlerInput,
  ResponseDescription,
} from '@solid/community-server'
import { getLoggerFor } from 'global-logger-factory'

import type { SessionManager } from './SessionManager.js'

/**
 * Hands the caller an LWS access token for a data or registry storage.
 *
 * Route `/.sai/lws-token?resource=<storage IRI>`, **GET** only. The SAI UI
 * holds a Solid-OIDC DPoP session (enough for the `.sai` API) but no ID token
 * it could exchange at the storage's LWS authorization server; the UAS mints
 * the token on its behalf through the same self-issued ID token its worker
 * sessions use.
 *
 * The token identifies the **caller** (`sub` = the caller's WebID, `client_id`
 * = its Authorization Agent), so the storage's own authorization still
 * applies: the endpoint never widens what the caller may access.
 */
export class LwsTokenHandler extends OperationHttpHandler {
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
    if (operation.method !== 'GET') {
      throw new MethodNotAllowedHttpError(['GET'])
    }
    const credentials = await this.credentialsExtractor.handleSafe(request)
    const webId = credentials.agent?.webId
    if (!webId) {
      throw new ForbiddenHttpError('authentication is required to obtain an LWS access token')
    }
    // The query is read from the raw request URL: the deployment's
    // TargetExtractor strips query strings, so `operation.target.path` does
    // not carry `?resource=`.
    const resource = new URL(request.url ?? '', 'http://dummy-base.example').searchParams.get(
      'resource'
    )
    if (!resource) {
      throw new BadRequestHttpError('missing resource query parameter')
    }
    let target: URL
    try {
      target = new URL(resource)
    } catch {
      throw new BadRequestHttpError(`resource must be an absolute http(s) IRI: ${resource}`)
    }
    if (target.protocol !== 'http:' && target.protocol !== 'https:') {
      throw new BadRequestHttpError(`resource must be an absolute http(s) IRI: ${resource}`)
    }

    const token = await this.sessionManager.getLwsAccessToken(webId, target.href)
    const body = JSON.stringify({
      access_token: token.accessToken,
      token_type: 'Bearer',
      expires_in: token.expiresIn,
    })
    const representation = new BasicRepresentation(body, operation.target, 'application/json')
    return new OkResponseDescription(representation.metadata, representation.data)
  }
}
