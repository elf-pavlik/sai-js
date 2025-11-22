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
import {
  getApplications,
  getSocialAgentInvitations,
  getSocialAgents,
  getUnregisteredApplication,
} from './services/AgentRegistry.js'
import { getDataRegistries, listDataInstances } from './services/DataRegistry.js'

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
        getDataRegistries: (agentId, lang) =>
          Effect.promise(() => getDataRegistries(session, agentId, lang)),
        listDataInstances: (agentId, registrationId) =>
          Effect.promise(() => listDataInstances(session, agentId, registrationId)),
        getApplications: () => Effect.promise(() => getApplications(session)),
        getUnregisteredApplication: (id) =>
          Effect.promise(() => getUnregisteredApplication(session, id)),
        getSocialAgents: () => Effect.promise(() => getSocialAgents(session)),
        getSocialAgentInvitations: () => Effect.promise(() => getSocialAgentInvitations(session)),
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
