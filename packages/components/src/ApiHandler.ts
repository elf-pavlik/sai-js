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
import { getLoggerFor } from 'global-logger-factory'
import type { PushSubscription } from 'web-push'
import type { SessionManager } from './SessionManager'
import type { UiPushSubscriptionStore } from './UiPushSubscriptionStore.js'
import type { AccountService } from './services/Account.js'
import { addAdmin, removeAdmin } from './services/Admin.js'
import { resolveContext } from './services/Context.js'
import {
  acceptInvitation,
  createInvitation,
  getApplications,
  getSocialAgentInvitations,
  getSocialAgents,
  getUnregisteredApplication,
} from './services/AgentRegistry.js'
import { getDescriptions, recordAuthorization } from './services/Authorization.js'
import { getDataRegistries, listDataInstances } from './services/DataRegistry.js'
import { revokeGrants } from './services/Revocation.js'
import { createRole, deleteRole, getRoles, updateRole } from './services/RoleRegistry.js'
import {
  getResource,
  requestAccessUsingApplicationNeeds,
  shareResource,
} from './services/ShareResource.js'

export class ApiHandler extends OperationHttpHandler {
  protected readonly logger = getLoggerFor(this)
  constructor(
    private readonly cookieStore: CookieStore,
    private readonly webIdStore: WebIdStore,
    private readonly uiPushSubscriptionStore: UiPushSubscriptionStore,
    private readonly sessionManager: SessionManager,
    private readonly accountService: AccountService,
    private readonly sparqlEndpoint: string
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
    const webId = webIdLinks[0]?.webId
    let session: AuthorizationAgent
    if (webId) {
      try {
        session = await this.sessionManager.getSession(webId)
      } catch (err) {
        console.error(err)
        throw err
      }
    }

    const SaiServiceLive = Layer.succeed(
      SaiService,
      // @ts-ignore
      SaiService.of({
        getWebId: () => Effect.succeed(session.webId),
        checkHandle: (handle: string) =>
          Effect.promise(() => this.accountService.checkHandle(handle)),
        bootstrapAccount: (handle: string) =>
          Effect.promise(() => this.accountService.bootstrapAccount(accountId, handle)),
        getDataRegistries: (agentId, lang, context) =>
          Effect.promise(async () => {
            const ctx = await resolveContext(session, context, this.sessionManager)
            return getDataRegistries(ctx.session, agentId, lang)
          }),
        listDataInstances: (agentId, registrationId, context) =>
          Effect.promise(async () => {
            const ctx = await resolveContext(session, context, this.sessionManager)
            return listDataInstances(ctx.session, agentId, registrationId, 'en')
          }),
        getApplications: (context) =>
          Effect.promise(async () => {
            const ctx = await resolveContext(session, context, this.sessionManager)
            return getApplications(ctx.session)
          }),
        getUnregisteredApplication: (id) =>
          Effect.promise(() => getUnregisteredApplication(session, id)),
        getSocialAgents: (context) =>
          Effect.promise(async () => {
            const ctx = await resolveContext(session, context, this.sessionManager)
            return getSocialAgents(ctx.session, ctx.webId === ctx.userWebId)
          }),
        getRoles: (context) =>
          Effect.promise(async () => {
            const ctx = await resolveContext(session, context, this.sessionManager)
            return getRoles(ctx.session)
          }),
        createRole: (label, members, context) =>
          Effect.promise(async () => {
            const ctx = await resolveContext(session, context, this.sessionManager)
            return createRole(ctx.session, label, members)
          }),
        updateRole: (id, label, members, context) =>
          Effect.promise(async () => {
            const ctx = await resolveContext(session, context, this.sessionManager)
            return updateRole(ctx.session, id, label, members)
          }),
        deleteRole: (id, context) =>
          Effect.promise(async () => {
            const ctx = await resolveContext(session, context, this.sessionManager)
            return deleteRole(ctx.session, id)
          }),
        getSocialAgentInvitations: (context) =>
          Effect.promise(async () => {
            const ctx = await resolveContext(session, context, this.sessionManager)
            return getSocialAgentInvitations(ctx.session)
          }),
        getAuthorizationData: (agentId, agentType, lang, accessNeedGroupIri, context) =>
          Effect.promise(async () => {
            const ctx = await resolveContext(session, context, this.sessionManager)
            return getDescriptions(ctx.session, agentId, agentType, lang, accessNeedGroupIri)
          }),
        authorizeApp: (authorization, context) =>
          Effect.promise(async () => {
            const ctx = await resolveContext(session, context, this.sessionManager)
            return recordAuthorization(ctx.session, authorization)
          }),
        revokeGrants: (grants, context) =>
          Effect.promise(async () => {
            const ctx = await resolveContext(session, context, this.sessionManager)
            return revokeGrants(ctx.session, this.sparqlEndpoint, grants)
          }),
        addAdmin: (webId, context) =>
          Effect.promise(async () => {
            const ctx = await resolveContext(session, context, this.sessionManager)
            return addAdmin(ctx.session, webId)
          }),
        removeAdmin: (webId, context) =>
          Effect.promise(async () => {
            const ctx = await resolveContext(session, context, this.sessionManager)
            return removeAdmin(ctx.session, webId)
          }),
        registerPushSubscription: (subscription: PushSubscription) =>
          Effect.promise(() =>
            this.uiPushSubscriptionStore.create(session.webId, accountId, subscription)
          ),
        getResource: (id, lang, context) =>
          Effect.promise(async () => {
            const ctx = await resolveContext(session, context, this.sessionManager)
            return getResource(ctx.session, id, lang)
          }),
        shareResource: (authorization, context) =>
          Effect.promise(async () => {
            const ctx = await resolveContext(session, context, this.sessionManager)
            return shareResource(ctx.session, authorization)
          }),
        requestAccessUsingApplicationNeeds: (applicationId, agentId, context) =>
          Effect.promise(async () => {
            const ctx = await resolveContext(session, context, this.sessionManager)
            return requestAccessUsingApplicationNeeds(ctx.session, applicationId, agentId)
          }),
        createInvitation: (label, note, context) =>
          Effect.promise(async () => {
            const ctx = await resolveContext(session, context, this.sessionManager)
            return createInvitation(ctx.session, { label, note })
          }),
        acceptInvitation: (capabilityUrl, label, note, context) =>
          Effect.promise(async () => {
            const ctx = await resolveContext(session, context, this.sessionManager)
            return acceptInvitation(ctx.session, { capabilityUrl, label, note })
          }),
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
