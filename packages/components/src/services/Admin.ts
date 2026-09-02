import { ActivityRegistry } from '@janeirodigital/interop-authorization-agent'
import type {
  AdminAuthorizationRecorded,
  AdminAuthorizationRevoked,
} from '@janeirodigital/interop-data-model'
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

  const recorded = await ctx.session.recordAdminAuthorization(
    {
      grantee: webId,
      grantedBy: ctx.webId,
      scopeOfAuthorization: INTEROP.All,
    },
    authorizationRegistry
  )

  const activityRegistry = ctx.registrySet.hasActivityRegistry
  if (!activityRegistry) throw new Error('activity registry not found in registry set')
  // the promoted admin's grantee rides a urn:uuid SNAPSHOT of the
  // AdminAuthorization — the dispatch dereferences nothing (the RPC's
  // synchronous record stays; step 7 materializes in the workflow and may
  // return the object to the live-link form)
  const activity: Omit<AdminAuthorizationRecorded, 'id'> = {
    type: ['Activity', 'AdminAuthorizationRecorded'],
    actor: ctx.webId,
    target: authorizationRegistry.id,
    object: {
      id: `urn:uuid:${ctx.session.randomUUID()}`,
      type: recorded.type,
      grantee: recorded.grantee,
      grantedBy: recorded.grantedBy,
      scopeOfAuthorization: recorded.scopeOfAuthorization,
    },
    createdAt: new Date().toISOString(),
  }
  await ActivityRegistry.createActivity(
    activityRegistry,
    { fetch: ctx.session.fetch, randomUUID: ctx.session.randomUUID },
    activity
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

  const activityRegistry = ctx.registrySet.hasActivityRegistry
  if (!activityRegistry) throw new Error('activity registry not found in registry set')
  // the demoted admin's grantee rides a urn:uuid SNAPSHOT of the
  // AdminAuthorization — the RPC deletes the resource synchronously below, so
  // a live link would be unresolvable at dispatch time (step 8 moves the
  // delete into the workflow and the object returns to the live-link form)
  const activity: Omit<AdminAuthorizationRevoked, 'id'> = {
    type: ['Activity', 'AdminAuthorizationRevoked'],
    actor: ctx.webId,
    target: authorizationRegistry.id,
    object: {
      id: `urn:uuid:${ctx.session.randomUUID()}`,
      type: existing.type,
      grantee: existing.grantee,
      grantedBy: existing.grantedBy,
      scopeOfAuthorization: existing.scopeOfAuthorization,
    },
    createdAt: new Date().toISOString(),
  }
  await ActivityRegistry.createActivity(
    activityRegistry,
    { fetch: ctx.session.fetch, randomUUID: ctx.session.randomUUID },
    activity
  )
  await ctx.session.deleteAdminAuthorization(existing.id)

  return buildSocialAgentProfile(registration, ctx, false)
}
