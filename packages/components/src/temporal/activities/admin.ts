import { replaceAdminGrantLinks } from '@janeirodigital/interop-authorization-agent'
import type {
  AdminAuthorizationData,
  AgentId,
  EmbeddedAdminAuthorization,
  SocialAgentId,
} from '@janeirodigital/interop-data-model'
import {
  AdminAuthorization,
  Grant,
  dataGrantAcrJsonLd,
  dataModelContext,
  rewriteFullAdminAccess,
} from '@janeirodigital/interop-data-model'
const loadGrant = loader(Grant.fromJsonLd)

import {
  ACL,
  INTEROP,
  discoverAccessResource,
  discoverAuthorizationAgent,
  expandedJsonLd,
  fetchJsonLd,
  getAcl,
  iriForContained,
  containedIrisJsonLd,
  loader,
  putJsonLd,
  withContext,
} from '@janeirodigital/interop-utils'

import { buildSessionManager } from '../../builders/sessionManager.js'

/**
 * AdminGrant payload — mirrors the §3.6 seed shapes: one RegistrySet-scoped
 * grant (the admin marker, linked on the registration) + one Read-only
 * DataRegistry-scoped grant per data registry in the RegistrySet.
 */
export type AdminGrantData = {
  id?: string
  type: string[]
  grantee: string
  grantedBy: string
  dataOwner: string
  scopeOfAdminGrant: string
  hasStorage?: string
  accessMode?: string[]
}

export interface AdminActivityInput {
  webId: SocialAgentId
  /** the admin webId (typed SocialAgent) */
  admin: AgentId
  /** IRI of the activity that triggered this workflow — marked done on success */
  activityId?: string
}

export interface AdminGrantsData {
  registrySetGrant: AdminGrantData
  dataRegistryGrants: AdminGrantData[]
}

/**
 * The activity-first addAdmin leg (step 5): PUT the AdminAuthorization at the
 * PRE-MINTED id with the context's own session. Find-first by the STABLE
 * pre-minted id — idempotent under retries/reconcile: a re-run after a crash
 * sees the resource already materialized and skips (the `If-None-Match: *`
 * PUT would 412 on the second attempt). The grantee rides the embedded
 * object; the type is the constant AdminAuthorization class.
 */
export async function recordAdminAuthorizationAtId(payload: {
  webId: SocialAgentId
  authorization: EmbeddedAdminAuthorization
}): Promise<void> {
  const manager = buildSessionManager()
  const session = await manager.getSession(payload.webId.id)
  const existing = await fetchJsonLd(payload.authorization.id, session.fetch).catch(
    (): undefined => undefined
  )
  if (existing) return
  const data: AdminAuthorizationData = {
    id: payload.authorization.id,
    type: [INTEROP.AdminAuthorization],
    grantee: payload.authorization.grantee,
    grantedBy: payload.authorization.grantedBy,
    scopeOfAuthorization: payload.authorization.scopeOfAuthorization,
  }
  await putJsonLd(payload.authorization.id, session.fetch, AdminAuthorization.toJsonLd(data), {
    'If-None-Match': '*',
  })
}

/**
 * The activity-first removeAdmin leg (step 6): DELETE the AdminAuthorization
 * at the EXISTING id with the context's own session. Find-first by the
 * STABLE id — idempotent under retries/reconcile: a retry after a crash
 * between the DELETE and the completion sees the resource already gone and
 * skips (must NOT throw — the affected set rides the embedded object).
 */
export async function deleteAdminAuthorizationAtId(payload: {
  webId: SocialAgentId
  authorization: EmbeddedAdminAuthorization
}): Promise<void> {
  const manager = buildSessionManager()
  const session = await manager.getSession(payload.webId.id)
  const existing = await fetchJsonLd(payload.authorization.id, session.fetch).catch(
    (): undefined => undefined
  )
  if (!existing) return
  await session.deleteAdminAuthorization(payload.authorization.id)
}

/**
 * Build the admin's grant payloads in the org's GrantRegistry: the
 * RegistrySet-scoped admin marker first, then one Read-only DataRegistry-
 * scoped grant per data registry in the org's RegistrySet (the engine's
 * source for org-context data-registry iteration/labels).
 */
export async function buildAdminGrants(payload: {
  webId: SocialAgentId
  admin: AgentId
}): Promise<AdminGrantsData> {
  const manager = buildSessionManager()
  const session = await manager.getSession(payload.webId.id)
  const registry = session.registrySet.hasGrantRegistry

  const registrySetGrant: AdminGrantData = {
    id: iriForContained(registry, session.randomUUID),
    type: [INTEROP.AdminGrant],
    grantee: payload.admin.id,
    grantedBy: payload.webId.id,
    dataOwner: payload.webId.id,
    scopeOfAdminGrant: INTEROP.RegistrySet,
  }

  const dataRegistryGrants: AdminGrantData[] = []
  for (const dataRegistry of session.registrySet.hasDataRegistry) {
    dataRegistryGrants.push({
      id: iriForContained(registry, session.randomUUID),
      type: [INTEROP.AdminGrant],
      grantee: payload.admin.id,
      grantedBy: payload.webId.id,
      dataOwner: payload.webId.id,
      scopeOfAdminGrant: INTEROP.DataRegistry,
      hasStorage: dataRegistry.id,
      accessMode: [ACL.Read],
    })
  }
  return { registrySetGrant, dataRegistryGrants }
}

/** PUT an AdminGrant resource into the org's GrantRegistry (org session). */
export async function storeAdminGrant(grant: AdminGrantData): Promise<void> {
  const manager = buildSessionManager()
  const session = await manager.getSession(grant.dataOwner)

  const body = JSON.stringify(await expandedJsonLd(withContext(dataModelContext, grant)))
  const response = await session.fetch(grant.id!, {
    method: 'PUT',
    body,
    headers: {
      'Content-Type': 'application/ld+json',
      'If-None-Match': '*',
    },
  })
  if (!response.ok) throw new Error(`failed to store admin grant: ${response.status}`)
}

/**
 * ACR for an AdminGrant: org fullOwnerAccess (org + its UAS) + peerReadAccess
 * (the admin + their UAS) — same shape as the data-grant ACRs.
 */
export async function createAdminGrantAcr(payload: { grant: AdminGrantData }): Promise<void> {
  const manager = buildSessionManager()
  const session = await manager.getSession(payload.grant.dataOwner)
  const uasId = await discoverAuthorizationAgent(payload.grant.grantee, fetch)
  if (!uasId) throw new Error(`no authorization agent for admin: ${payload.grant.grantee}`)

  const headResponse = await session.fetch(payload.grant.id!, {
    method: 'HEAD',
  })
  const acrId = getAcl(headResponse.headers.get('link'))
  if (!acrId) throw new Error(`no acl link on admin grant: ${payload.grant.id}`)

  await putJsonLd(
    acrId,
    session.fetch,
    dataGrantAcrJsonLd({
      id: acrId,
      resource: payload.grant.id!,
      owner: {
        agent: session.webId,
        client: session.agentId,
      },
      peer: {
        agent: payload.grant.grantee,
        client: uasId,
      },
    })
  )
}

/** Set the admin's registration hasAdminGrant links to exactly `grantIds`. */
export async function replaceAdminGrantLink(payload: {
  webId: SocialAgentId
  admin: AgentId
  grantIds: string[]
}): Promise<void> {
  const manager = buildSessionManager()
  const session = await manager.getSession(payload.webId.id)
  const registration = await session.findSocialAgentRegistration(payload.admin.id)
  if (!registration) {
    throw new Error(`social agent registration for admin ${payload.admin.id} not found`)
  }
  await replaceAdminGrantLinks(registration, session.fetch, payload.grantIds)
}

/** The admin's AdminGrants in the org's GrantRegistry (by grantee). */
export async function findAdminGrants(payload: {
  webId: SocialAgentId
  admin: AgentId
}): Promise<{ id: string; type: string[] }[]> {
  const manager = buildSessionManager()
  const session = await manager.getSession(payload.webId.id)
  const registry = session.registrySet.hasGrantRegistry
  const iris = await containedIrisJsonLd(registry.id, session.fetch)
  const adminGrants: { id: string; type: string[] }[] = []
  for (const iri of iris) {
    const grant = await loadGrant(iri, session.fetch)
    if (grant.type.includes(INTEROP.AdminGrant) && grant.grantee === payload.admin.id) {
      adminGrants.push({ id: iri, type: grant.type })
    }
  }
  return adminGrants
}

/** Delete the admin's AdminGrant resources (and their ACRs); 404 is tolerated. */
export async function deleteAdminGrants(payload: {
  webId: SocialAgentId
  grants: { id: string; type: string[] }[]
}): Promise<void> {
  const manager = buildSessionManager()
  const session = await manager.getSession(payload.webId.id)
  for (const grant of payload.grants) {
    const headResponse = await session.fetch(grant.id, { method: 'HEAD' })
    if (headResponse.ok) {
      const acrId = getAcl(headResponse.headers.get('link'))
      if (acrId) {
        const acrResponse = await session.fetch(acrId, { method: 'DELETE' })
        if (!acrResponse.ok && acrResponse.status !== 404) {
          throw new Error(`failed to delete admin grant acr: ${acrResponse.status}`)
        }
      }
    }
    const response = await session.fetch(grant.id, { method: 'DELETE' })
    if (!response.ok && response.status !== 404) {
      throw new Error(`failed to delete admin grant: ${response.status}`)
    }
  }
}

/**
 * Rewrite the registry-set `.acr` `#fullAdminAccess` access control from the
 * current admin list (idempotent derived rewrite; the AuthorizationRegistry
 * is the single source of truth). Also wires the control into the access
 * control resource's `#root` (`acp:accessControl`/`acp:memberAccessControl`)
 * so it applies to the registry set and its members — contexts whose seed
 * never wired it (e.g. a personal registry set) get the enforcement on the
 * first promotion. An EMPTY admin list is legitimate for the personal
 * context (Phase 5 — the owner remains the operator after demoting their
 * only admin): the rewrite then removes the `#fullAdminAccess` control
 * entirely. For orgs the RPC last-admin guard prevents reaching this state
 * through the UI.
 */
export async function syncAdminAcr(payload: { webId: SocialAgentId }): Promise<void> {
  const manager = buildSessionManager()
  const session = await manager.getSession(payload.webId.id)

  const admins = await session.adminAuthorizations(session.registrySet.hasAuthorizationRegistry)

  const matchers: { agent: string; client: string }[] = []
  for (const admin of admins) {
    const uasId = await discoverAuthorizationAgent(admin.grantee, fetch)
    if (!uasId) throw new Error(`no authorization agent for admin: ${admin.grantee}`)
    matchers.push({ agent: admin.grantee, client: uasId })
  }

  const acrId = await discoverAccessResource(session.registrySet.id, session.fetch)
  if (!acrId) throw new Error(`no acl link on registry set: ${session.registrySet.id}`)

  // idempotent remove-then-add of the #fullAdminAccess control (and its #root
  // wiring) — an empty admin list removes the control entirely
  const doc = await fetchJsonLd(acrId, session.fetch)
  await putJsonLd(acrId, session.fetch, rewriteFullAdminAccess(doc, acrId, matchers))
}
