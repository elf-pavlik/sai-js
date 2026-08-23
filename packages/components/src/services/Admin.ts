import type { AuthorizationAgent } from '@janeirodigital/interop-authorization-agent'
import { ActivityRegistry, AuthorizationRegistry } from '@janeirodigital/interop-data-model'
import { INTEROP } from '@janeirodigital/interop-utils'
import type { IRI, SocialAgent } from '@janeirodigital/sai-api-messages'
import type * as S from 'effect/Schema'
import { buildSocialAgentProfile } from './AgentRegistry.js'

/**
 * Promote a registered social agent to org admin: record an
 * `AdminAuthorization` in the org's AuthorizationRegistry, then write the
 * `adminAuthorizationRecorded` activity which drives the grant/ACR workflows.
 * Runs on the org's own AA session — `saiSession.webId` is the org.
 */
export const addAdmin = async (
  saiSession: AuthorizationAgent,
  webId: S.Schema.Type<typeof IRI>
): Promise<S.Schema.Type<typeof SocialAgent>> => {
  const registration = await saiSession.findSocialAgentRegistration(webId)
  if (!registration) throw new Error(`Social Agent Registration for ${webId} not found`)

  const authorizationRegistry = saiSession.registrySet.hasAuthorizationRegistry
  const existing = await AuthorizationRegistry.findAdminAuthorization(
    authorizationRegistry,
    saiSession.factory,
    webId
  )
  if (existing) throw new Error(`Admin Authorization for ${webId} already exists`)

  await AuthorizationRegistry.recordAdminAuthorization(authorizationRegistry, saiSession.factory, {
    grantee: webId,
    grantedBy: saiSession.webId,
    scopeOfAuthorization: INTEROP.All,
  })

  const activityRegistry = saiSession.registrySet.hasActivityRegistry
  if (!activityRegistry) throw new Error('activity registry not found in registry set')
  await ActivityRegistry.createActivity(activityRegistry, saiSession.factory, {
    activityType: 'adminAuthorizationRecorded',
    target: authorizationRegistry.id,
    payload: {
      webId: { id: saiSession.webId, type: [INTEROP.SocialAgent] },
      admin: { id: webId, type: [INTEROP.SocialAgent] },
    },
    createdAt: new Date().toISOString(),
  })

  return buildSocialAgentProfile(registration, saiSession, false)
}

/**
 * Demote a registered social agent from org admin: delete the
 * `AdminAuthorization` (refusing to remove the last admin), then write the
 * `adminAuthorizationRevoked` activity which drives the grant/ACR workflows.
 */
export const removeAdmin = async (
  saiSession: AuthorizationAgent,
  webId: S.Schema.Type<typeof IRI>
): Promise<S.Schema.Type<typeof SocialAgent>> => {
  const registration = await saiSession.findSocialAgentRegistration(webId)
  if (!registration) throw new Error(`Social Agent Registration for ${webId} not found`)

  const authorizationRegistry = saiSession.registrySet.hasAuthorizationRegistry
  const existing = await AuthorizationRegistry.findAdminAuthorization(
    authorizationRegistry,
    saiSession.factory,
    webId
  )
  if (!existing) throw new Error(`Admin Authorization for ${webId} not found`)

  // last-admin guard — the org must never end up adminless (enforced again by syncAdminAcr)
  let count = 0
  for await (const _adminAuthorization of AuthorizationRegistry.adminAuthorizations(
    authorizationRegistry,
    saiSession.factory
  )) {
    count += 1
  }
  if (count === 1) throw new Error('can not remove the last admin')

  await AuthorizationRegistry.deleteAdminAuthorization(existing.id, saiSession.factory)

  const activityRegistry = saiSession.registrySet.hasActivityRegistry
  if (!activityRegistry) throw new Error('activity registry not found in registry set')
  await ActivityRegistry.createActivity(activityRegistry, saiSession.factory, {
    activityType: 'adminAuthorizationRevoked',
    target: authorizationRegistry.id,
    payload: {
      webId: { id: saiSession.webId, type: [INTEROP.SocialAgent] },
      admin: { id: webId, type: [INTEROP.SocialAgent] },
    },
    createdAt: new Date().toISOString(),
  })

  return buildSocialAgentProfile(registration, saiSession, false)
}
