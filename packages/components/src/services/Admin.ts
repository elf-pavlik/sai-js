import { ActivityRegistry } from '@janeirodigital/interop-authorization-agent'
import { INTEROP } from '@janeirodigital/interop-utils'
import type { IRI, SocialAgent } from '@janeirodigital/sai-api-messages'
import type * as S from 'effect/Schema'
import { buildSocialAgentProfile, findSocialAgentRegistrationInContext } from './SocialAgentRegistry.js'
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
  const existing = await ctx.session.findAdminAuthorization(webId, authorizationRegistry)
  if (existing) throw new Error(`Admin Authorization for ${webId} already exists`)

  await ctx.session.recordAdminAuthorization(
    {
      grantee: webId,
      grantedBy: ctx.webId,
      scopeOfAuthorization: INTEROP.All,
    },
    authorizationRegistry
  )

  const activityRegistry = ctx.registrySet.hasActivityRegistry
  if (!activityRegistry) throw new Error('activity registry not found in registry set')
  await ActivityRegistry.createActivity(
    activityRegistry,
    { fetch: ctx.session.fetch, randomUUID: ctx.session.randomUUID },
    {
      activityType: 'adminAuthorizationRecorded',
      target: authorizationRegistry.id,
      payload: {
        webId: { id: ctx.webId, type: [INTEROP.SocialAgent] },
        admin: { id: webId, type: [INTEROP.SocialAgent] },
      },
      createdAt: new Date().toISOString(),
    }
  )

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
  const existing = await ctx.session.findAdminAuthorization(webId, authorizationRegistry)
  if (!existing) throw new Error(`Admin Authorization for ${webId} not found`)

  // last-admin guard — the org must never end up adminless (enforced again by syncAdminAcr)
  let count = 0
  for (const _adminAuthorization of await ctx.session.adminAuthorizations(authorizationRegistry)) {
    count += 1
  }
  if (count === 1) throw new Error('can not remove the last admin')

  await ctx.session.deleteAdminAuthorization(existing.id)

  const activityRegistry = ctx.registrySet.hasActivityRegistry
  if (!activityRegistry) throw new Error('activity registry not found in registry set')
  await ActivityRegistry.createActivity(
    activityRegistry,
    { fetch: ctx.session.fetch, randomUUID: ctx.session.randomUUID },
    {
      activityType: 'adminAuthorizationRevoked',
      target: authorizationRegistry.id,
      payload: {
        webId: { id: ctx.webId, type: [INTEROP.SocialAgent] },
        admin: { id: webId, type: [INTEROP.SocialAgent] },
      },
      createdAt: new Date().toISOString(),
    }
  )

  return buildSocialAgentProfile(registration, ctx, false)
}
