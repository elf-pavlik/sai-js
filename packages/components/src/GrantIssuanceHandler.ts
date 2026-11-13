import { discoverAuthorizationAgent } from '@janeirodigital/interop-utils'
import {
  BadRequestHttpError,
  ForbiddenHttpError,
  OperationHttpHandler,
  ResponseDescription,
  UnauthorizedHttpError,
  UnsupportedMediaTypeHttpError,
  readableToString,
} from '@solid/community-server'
import type { CredentialsExtractor, OperationHttpHandlerInput } from '@solid/community-server'
import { getLoggerFor } from 'global-logger-factory'

import { isNeedBasedAccessRequestMessage } from './messages.js'
import {
  acceptNeedBasedAccessRequest,
  isOdrlNeedBasedAccessRequest,
  needBasedAccessRequestFromOdrl,
} from './need-based-access-request.js'
import type { SessionManager } from './SessionManager'

/** The JSON-LD media type the legacy endpoint requires. */
const LD_JSON_MEDIA_TYPE = 'application/ld+json'

/**
 * Legacy `.sai/grants` POST route.
 *
 * Delegation issuance and revocation now live on the owner-scoped access
 * request endpoint. The old needs-request branches are kept temporarily as
 * request-shape compatibility until the cleanup step.
 */
export class GrantIssuanceHandler extends OperationHttpHandler {
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
    if (!credentials.agent?.webId || !credentials.client?.clientId) {
      // missing credentials is an AUTHENTICATION failure — 401, not 403
      throw new UnauthorizedHttpError()
    }
    // TODO: check if WebID served by this authz agent

    const contentType = operation.body.metadata.contentType?.toLowerCase() ?? ''
    if (
      contentType !== LD_JSON_MEDIA_TYPE &&
      contentType !== 'application/lws+json' &&
      !contentType.startsWith('application/ld+json;')
    ) {
      throw new UnsupportedMediaTypeHttpError(
        'expected application/ld+json or application/lws+json'
      )
    }

    const uasId = await discoverAuthorizationAgent(credentials.agent.webId, fetch)
    if (credentials.client.clientId !== uasId) {
      throw new ForbiddenHttpError()
    }

    const message = await this.parseMessage(operation)
    if (isOdrlNeedBasedAccessRequest(message)) {
      return acceptNeedBasedAccessRequest(
        this.sessionManager,
        needBasedAccessRequestFromOdrl(message, credentials.agent.webId),
        credentials.agent.webId
      )
    }
    if (isNeedBasedAccessRequestMessage(message)) {
      return acceptNeedBasedAccessRequest(this.sessionManager, message, credentials.agent.webId)
    }
    throw new BadRequestHttpError('invalid access request message')
  }

  private async parseMessage(operation: OperationHttpHandlerInput['operation']): Promise<unknown> {
    try {
      return JSON.parse(await readableToString(operation.body.data))
    } catch (err) {
      throw new BadRequestHttpError((err as Error).message)
    }
  }
}
