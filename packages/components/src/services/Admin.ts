import { ActivityRegistry, AuthorizationRegistry } from '@janeirodigital/interop-data-model'
import { INTEROP } from '@janeirodigital/interop-utils'
import type { IRI, SocialAgent } from '@janeirodigital/sai-api-messages'
import type * as S from 'effect/Schema'
import { buildSocialAgentProfile, findSocialAgentRegistrationInContext } from './AgentRegistry.js'
import type { ResolvedContext } from './Context.js'

/**
 * Promote a registered social agent to org admin: record an
 * `AdminAuthorization` in the context's AuthorizationRegistry, then write the
 * `adminAuthorizationRecorded` activity which drives the grant/ACR workflows.
 * Runs on the signed-in user's AA — the owner identity (`ctx.webId`) is the
 * context (the org), the admin's UAS authenticates the writes.
 */
export const addAdmin = async (
  ctx: ResolvedContext,
  webId: S.Schema.Type<typeof IRI>
): Promise<S.Schema.Type<typeof SocialAgent>> => {
  const registration = await findSocialAgentRegistrationInContext(ctx, webId)
  if (!registration) throw new Error(`Social Agent Registration for ${webId} not found`)

  const authorizationRegistry = ctx.registrySet.hasAuthorizationRegistry
  const existing = await AuthorizationRegistry.findAdminAuthorization(
    authorizationRegistry,
    ctx.session.factory,
    webId
  )
  if (existing) throw new Error(`Admin Authorization for ${webId} already exists`)

  await AuthorizationRegistry.recordAdminAuthorization(authorizationRegistry, ctx.session.factory, {
    grantee: webId,
    grantedBy: ctx.webId,
    scopeOfAuthorization: INTEROP.All,
  })

  const activityRegistry = ctx.registrySet.hasActivityRegistry
  if (!activityRegistry) throw new Error('activity registry not found in registry set')
  await ActivityRegistry.createActivity(activityRegistry, ctx.session.factory, {
    activityType: 'adminAuthorizationRecorded',
    target: authorizationRegistry.id,
    payload: {
      webId: { id: ctx.webId, type: [INTEROP.SocialAgent] },
      admin: { id: webId, type: [INTEROP.SocialAgent] },
    },
    createdAt: new Date().toISOString(),
  })

  return buildSocialAgentProfile(registration, ctx, false)
}

/**
 * Demote a registered social agent from org admin: delete the
 * `AdminAuthorization` (refusing to remove the last admin), then write the
 * `adminAuthorizationRevoked` activity which drives the grant/ACR workflows.
 */
export const removeAdmin = async (
  ctx: ResolvedContext,
  webId: S.Schema.Type<typeof IRI>
): Promise<S.Schema.Type<typeof SocialAgent>> => {
  const registration = await findSocialAgentRegistrationInContext(ctx, webId)
  if (!registration) throw new Error(`Social Agent Registration for ${webId} not found`)

  const authorizationRegistry = ctx.registrySet.hasAuthorizationRegistry
  const existing = await AuthorizationRegistry.findAdminAuthorization(
    authorizationRegistry,
    ctx.session.factory,
    webId
  )
  if (!existing) throw new Error(`Admin Authorization for ${webId} not found`)

  // last-admin guard — the org must never end up adminless (enforced again by syncAdminAcr)
  let count = 0
  for await (const _adminAuthorization of AuthorizationRegistry.adminAuthorizations(
    authorizationRegistry,
    ctx.session.factory
  )) {
    count += 1
  }
  if (count === 1) throw new Error('can not remove the last admin')

  await AuthorizationRegistry.deleteAdminAuthorization(existing.id, ctx.session.factory)

  const activityRegistry = ctx.registrySet.hasActivityRegistry
  if (!activityRegistry) throw new Error('activity registry not found in registry set')
  await ActivityRegistry.createActivity(activityRegistry, ctx.session.factory, {
    activityType: 'adminAuthorizationRevoked',
    target: authorizationRegistry.id,
    payload: {
      webId: { id: ctx.webId, type: [INTEROP.SocialAgent] },
      admin: { id: webId, type: [INTEROP.SocialAgent] },
    },
    createdAt: new Date().toISOString(),
  })

  return buildSocialAgentProfile(registration, ctx, false)
}