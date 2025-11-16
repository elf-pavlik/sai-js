import { RpcRouter } from '@effect/rpc'
import type { AuthorizationAgent } from '@janeirodigital/interop-authorization-agent'
import { SaiService, router } from '@janeirodigital/sai-api-messages'
import {
  BasicRepresentation,
  ForbiddenHttpError,
  InternalServerError,
  OkResponseDescription,
  OperationHttpHandler,
  SOLID_HTTP,
  readableToString,
} from '@solid/community-server'
import type { CookieStore, WebIdStore } from '@solid/community-server'
import type { OperationHttpHandlerInput, ResponseDescription } from '@solid/community-server'
import { Effect, Layer } from 'effect'
import type { SessionManager } from './SessionManager'

export class ApiHandler extends OperationHttpHandler {
  constructor(
    private readonly cookieStore: CookieStore,
    private readonly webIdStore: WebIdStore,
    private readonly sessionManager: SessionManager
  ) {
    super()
  }
  public async handle({ operation }: OperationHttpHandlerInput): Promise<ResponseDescription> {
    // Determine account
    const cookie = operation.body.metadata.get(SOLID_HTTP.terms.accountCookie)?.value
    if (!cookie) {
      throw new ForbiddenHttpError()
    }
    const accountId = await this.cookieStore.get(cookie)
    if (!accountId) {
      // TODO: find better error
      throw new InternalServerError('no accountId')
    }
    const webIdLinks = await this.webIdStore.findLinks(accountId)
    const webId = webIdLinks[0].webId
    if (!webId) {
      // TODO: find better error
      throw new InternalServerError('no webId')
    }
    let session: AuthorizationAgent
    try {
      session = await this.sessionManager.getSession(webId)
    } catch (err) {
      console.error(err)
      throw err
    }
    const SaiServiceLive = Layer.succeed(
      SaiService,
      // @ts-ignore
      SaiService.of({
        getWebId: () => Effect.succeed(session.webId),
      })
    )
    const rpcHandler = RpcRouter.toHandlerNoStream(router)

    const requestBody = JSON.parse(await readableToString(operation.body.data))
    const program = Effect.gen(function* () {
      return yield* rpcHandler(requestBody)
    }).pipe(Effect.provide(SaiServiceLive))
    const payload = await Effect.runPromise(program)

    const doc = JSON.stringify(payload)
    const representation = new BasicRepresentation(doc, operation.target, 'application/json')
    return new OkResponseDescription(representation.metadata, representation.data)
  }
}
