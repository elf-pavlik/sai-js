import { ActivityRegistry } from '@janeirodigital/interop-authorization-agent'
import type {
  AdminAuthorizationRecorded,
  AdminAuthorizationRevoked,
} from '@janeirodigital/interop-data-model'
import { AdminAuthorizationRecordedMessage, IRI } from '@janeirodigital/sai-api-messages'
import { INTEROP, iriForContained } from '@janeirodigital/interop-utils'
import type { SocialAgent } from '@janeirodigital/sai-api-messages'
import type * as S from 'effect/Schema'
import { buildSocialAgentProfile, findSocialAgentRegistrationInContext } from './SocialAgentRegistry.js'
import type { ResolvedContext } from './Context.js'

/**
 * Promote a registered social agent to org admin (activity-first step 5 — R1
 * re-decision): the RPC keeps the VALIDATION reads (registered + not-already-
 * admin) and pre-mints the AdminAuthorization id, then writes the
 * `adminAuthorizationRecorded` activity (object = the AdminAuthorization-to-be,
 * real-id embedded projection at that id — `target` dropped). The `addAdmin`
 * workflow PUTs the resource at the pre-minted id, materializes the admin
 * grants + ACR rewrite, then completes. Runs on the signed-in user's AA — the
 * owner identity (`ctx.webId`) is the context (the org).
 */
export const addAdmin = async (
  ctx: ResolvedContext,
  webId: S.Schema.Type<typeof IRI>
): Promise<S.Schema.Type<typeof AdminAuthorizationRecordedMessage>> => {
  const registration = await findSocialAgentRegistrationInContext(ctx, webId)
  if (!registration) throw new Error(`Social Agent Registration for ${webId} not found`)

  const authorizationRegistry = ctx.registrySet.hasAuthorizationRegistry
  const existing = await ctx.session.findAdminAuthorization(webId, authorizationRegistry)
  if (existing) throw new Error(`Admin Authorization for ${webId} already exists`)

  // pre-mint the AdminAuthorization id — the workflow PUTs the resource there
  // (the same minting the AA's recordAdminAuthorization would do)
  const authorizationId = iriForContained(authorizationRegistry, ctx.session.randomUUID)

  const activityRegistry = ctx.registrySet.hasActivityRegistry
  if (!activityRegistry) throw new Error('activity registry not found in registry set')
  const activity: Omit<AdminAuthorizationRecorded, 'id'> = {
    type: ['Activity', 'AdminAuthorizationRecorded'],
    actor: ctx.webId,
    object: {
      id: authorizationId,
      type: [INTEROP.AdminAuthorization],
      grantee: webId,
      grantedBy: ctx.webId,
      scopeOfAuthorization: INTEROP.All,
    },
    createdAt: new Date().toISOString(),
  }
  const created = await ActivityRegistry.createActivity(
    activityRegistry,
    { fetch: ctx.session.fetch, randomUUID: ctx.session.randomUUID },
    activity
  )
  // pending ack — echoes the pre-minted AdminAuthorization id (pending
  // handle) + the triggering activity id (the uniform UI claim anchor)
  return AdminAuthorizationRecordedMessage.make({
    id: IRI.make(authorizationId),
    activityId: IRI.make(created.id),
  })
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
