import { FetchHttpClient, HttpClient, HttpClientRequest } from '@effect/platform'
import { RpcResolver } from '@effect/rpc'
import { HttpRpcResolverNoStream } from '@effect/rpc-http'
import {
  AcceptInvitation,
  AddAdmin,
  type AgentType,
  type Authorization,
  AuthorizeApp,
  BootstrapAccount,
  CheckHandle,
  CreateInvitation,
  CreateRole,
  DeleteRole,
  GetAuthoriaztionData,
  GetResource,
  GetUnregisteredApplication,
  GetWebId,
  IRI,
  ListApplications,
  ListDataInstances,
  ListDataRegistries,
  ListRoles,
  ListSocialAgentInvitations,
  ListSocialAgents,
  RegisterPushSubscription,
  RemoveAdmin,
  RequestAccessUsingApplicationNeeds,
  RevokeGrants,
  type ShareAuthorization,
  ShareResource,
  type UiRpcRouter,
  UpdateRole,
} from '@janeirodigital/sai-api-messages'
import { Effect, Layer } from 'effect'
import type * as S from 'effect/Schema'
import type { PushSubscription } from 'web-push'
import { getRuntimeConfig } from './runtime-config'

// Create the client
const makeClient = Effect.gen(function* () {
  const client = yield* HttpClient.HttpClient

  return HttpRpcResolverNoStream.make<UiRpcRouter>(
    client.pipe(
      HttpClient.mapRequest(
        HttpClientRequest.prependUrl(`${getRuntimeConfig().backendBaseUrl}/.sai/api`)
      )
      // HttpClient.tapRequest(Console.log)
    )
  ).pipe(RpcResolver.toClient)
})

const AuthFetch = FetchHttpClient.layer.pipe(
  Layer.provide(
    Layer.succeed(FetchHttpClient.RequestInit, {
      credentials: 'include',
    })
  )
)

const AuthLayer = FetchHttpClient.layer.pipe(Layer.provide(AuthFetch))

export async function getWebId() {
  const program = Effect.gen(function* () {
    const client = yield* makeClient
    return yield* client(new GetWebId())
  }).pipe(Effect.provide(AuthLayer))
  return Effect.runPromise(program)
}

export async function checkHandle(handle: string) {
  const program = Effect.gen(function* () {
    const client = yield* makeClient
    return yield* client(new CheckHandle({ handle }))
  }).pipe(Effect.provide(AuthLayer))
  return Effect.runPromise(program)
}

export async function bootstrapAccount(handle: string) {
  const program = Effect.gen(function* () {
    const client = yield* makeClient
    return yield* client(new BootstrapAccount({ handle }))
  }).pipe(Effect.provide(AuthLayer))
  return Effect.runPromise(program)
}

export async function registerPushSubscription(subscription: PushSubscription) {
  const program = Effect.gen(function* () {
    const client = yield* makeClient
    return yield* client(new RegisterPushSubscription({ subscription }))
  }).pipe(Effect.provide(AuthLayer))
  return Effect.runPromise(program)
}

export async function listApplications(context: string) {
  const program = Effect.gen(function* () {
    const client = yield* makeClient
    return yield* client(new ListApplications({ context: IRI.make(context) }))
  }).pipe(Effect.provide(AuthLayer))
  return Effect.runPromise(program)
}

export async function getUnregisteredApplication(id: string) {
  const program = Effect.gen(function* () {
    const client = yield* makeClient
    return yield* client(new GetUnregisteredApplication({ id: IRI.make(id) }))
  }).pipe(Effect.provide(AuthLayer))
  return Effect.runPromise(program)
}

export async function getAuthoriaztionData(
  agentId: string,
  agentType: AgentType,
  lang: string,
  context: string,
  accessNeedGroupIri?: string,
  accessRequestIri?: string
) {
  const program = Effect.gen(function* () {
    const client = yield* makeClient
    return yield* client(
      new GetAuthoriaztionData({
        agentId: IRI.make(agentId),
        agentType,
        lang,
        context: IRI.make(context),
        ...(accessNeedGroupIri ? { accessNeedGroupIri: IRI.make(accessNeedGroupIri) } : {}),
        ...(accessRequestIri ? { accessRequestIri: IRI.make(accessRequestIri) } : {}),
      })
    )
  }).pipe(Effect.provide(AuthLayer))
  return Effect.runPromise(program)
}

export async function getResource(id: string, lang: string, context: string) {
  const program = Effect.gen(function* () {
    const client = yield* makeClient
    return yield* client(new GetResource({ id: IRI.make(id), lang, context: IRI.make(context) }))
  }).pipe(Effect.provide(AuthLayer))
  return Effect.runPromise(program)
}

export async function listSocialAgents(context: string) {
  const program = Effect.gen(function* () {
    const client = yield* makeClient
    return yield* client(new ListSocialAgents({ context: IRI.make(context) }))
  }).pipe(Effect.provide(AuthLayer))
  return Effect.runPromise(program)
}

export async function listRoles(context: string) {
  const program = Effect.gen(function* () {
    const client = yield* makeClient
    return yield* client(new ListRoles({ context: IRI.make(context) }))
  }).pipe(Effect.provide(AuthLayer))
  return Effect.runPromise(program)
}

export async function listSocialAgentInvitations(context: string) {
  const program = Effect.gen(function* () {
    const client = yield* makeClient
    return yield* client(new ListSocialAgentInvitations({ context: IRI.make(context) }))
  }).pipe(Effect.provide(AuthLayer))
  return Effect.runPromise(program)
}

export async function listDataRegistries(agentId: string, lang: string, context: string) {
  const program = Effect.gen(function* () {
    const client = yield* makeClient
    return yield* client(
      new ListDataRegistries({ agentId: IRI.make(agentId), lang, context: IRI.make(context) })
    )
  }).pipe(Effect.provide(AuthLayer))
  return Effect.runPromise(program)
}

export async function listDataInstances(
  agentId: S.Schema.Type<typeof IRI>,
  registrationId: S.Schema.Type<typeof IRI>,
  context: string
) {
  const program = Effect.gen(function* () {
    const client = yield* makeClient
    return yield* client(
      new ListDataInstances({
        agentId: agentId,
        registrationId: registrationId,
        context: IRI.make(context),
      })
    )
  }).pipe(Effect.provide(AuthLayer))
  return Effect.runPromise(program)
}

export async function requestAccessUsingApplicationNeeds(
  applicationId: string,
  agentId: string,
  context: string
) {
  const program = Effect.gen(function* () {
    const client = yield* makeClient
    return yield* client(
      new RequestAccessUsingApplicationNeeds({
        applicationId: IRI.make(applicationId),
        agentId: IRI.make(agentId),
        context: IRI.make(context),
      })
    )
  }).pipe(Effect.provide(AuthLayer))
  return Effect.runPromise(program)
}

export async function createInvitation(label: string, note: string | undefined, context: string) {
  const program = Effect.gen(function* () {
    const client = yield* makeClient
    return yield* client(
      new CreateInvitation({ label, note, context: IRI.make(context) })
    )
  }).pipe(Effect.provide(AuthLayer))
  return Effect.runPromise(program)
}

export async function acceptInvitation(
  capabilityUrl: string,
  label: string,
  note: string | undefined,
  context: string
) {
  const program = Effect.gen(function* () {
    const client = yield* makeClient
    return yield* client(
      new AcceptInvitation({ capabilityUrl, label, note, context: IRI.make(context) })
    )
  }).pipe(Effect.provide(AuthLayer))
  return Effect.runPromise(program)
}

export async function shareResource(
  authorization: S.Schema.Type<typeof ShareAuthorization>,
  context: string
) {
  const program = Effect.gen(function* () {
    const client = yield* makeClient
    return yield* client(new ShareResource({ authorization, context: IRI.make(context) }))
  }).pipe(Effect.provide(AuthLayer))
  return Effect.runPromise(program)
}

export async function authorizeApp(
  authorization: S.Schema.Type<typeof Authorization>,
  context: string,
  accessRequestIri?: string
) {
  const program = Effect.gen(function* () {
    const client = yield* makeClient
    return yield* client(
      new AuthorizeApp({
        authorization,
        context: IRI.make(context),
        ...(accessRequestIri ? { accessRequestIri: IRI.make(accessRequestIri) } : {}),
      })
    )
  }).pipe(Effect.provide(AuthLayer))
  return Effect.runPromise(program)
}

export async function revokeGrants(
  grants: readonly S.Schema.Type<typeof IRI>[],
  context: string
) {
  const program = Effect.gen(function* () {
    const client = yield* makeClient
    return yield* client(new RevokeGrants({ grants, context: IRI.make(context) }))
  }).pipe(Effect.provide(AuthLayer))
  return Effect.runPromise(program)
}

export async function createRole(
  label: string,
  members: readonly S.Schema.Type<typeof IRI>[],
  context: string
) {
  const program = Effect.gen(function* () {
    const client = yield* makeClient
    return yield* client(new CreateRole({ label, members, context: IRI.make(context) }))
  }).pipe(Effect.provide(AuthLayer))
  return Effect.runPromise(program)
}

export async function updateRole(
  id: S.Schema.Type<typeof IRI>,
  label: string,
  members: readonly S.Schema.Type<typeof IRI>[],
  context: string
) {
  const program = Effect.gen(function* () {
    const client = yield* makeClient
    return yield* client(
      new UpdateRole({ id, label, members, context: IRI.make(context) })
    )
  }).pipe(Effect.provide(AuthLayer))
  return Effect.runPromise(program)
}

export async function deleteRole(id: S.Schema.Type<typeof IRI>, context: string) {
  const program = Effect.gen(function* () {
    const client = yield* makeClient
    return yield* client(new DeleteRole({ id, context: IRI.make(context) }))
  }).pipe(Effect.provide(AuthLayer))
  return Effect.runPromise(program)
}

export async function addAdmin(webId: string, context: string) {
  const program = Effect.gen(function* () {
    const client = yield* makeClient
    return yield* client(new AddAdmin({ webId: IRI.make(webId), context: IRI.make(context) }))
  }).pipe(Effect.provide(AuthLayer))
  return Effect.runPromise(program)
}

export async function removeAdmin(webId: string, context: string) {
  const program = Effect.gen(function* () {
    const client = yield* makeClient
    return yield* client(new RemoveAdmin({ webId: IRI.make(webId), context: IRI.make(context) }))
  }).pipe(Effect.provide(AuthLayer))
  return Effect.runPromise(program)
}
