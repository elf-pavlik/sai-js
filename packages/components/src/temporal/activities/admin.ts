import { replaceAdminGrantLinks } from '@janeirodigital/interop-authorization-agent'
import type {
  AdminAuthorizationData,
  AgentId,
  EmbeddedAdminAuthorization,
  SocialAgentId,
} from '@janeirodigital/interop-data-model'
import { AdminAuthorization, dataGrantTemplate, dataModelContext, loadGrant } from '@janeirodigital/interop-data-model'
import {
  ACL,
  INTEROP,
  LDP,
  discoverAuthorizationAgent,
  expandedJsonLd,
  fetchJsonLd,
  getAcl,
  iriForContained,
  linkedIrisJsonLd,
  parseTurtle,
  putJsonLd,
  serializeTurtle,
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

const acp = {
  AccessControl: 'http://www.w3.org/ns/solid/acp#AccessControl',
  anyOf: 'http://www.w3.org/ns/solid/acp#anyOf',
  apply: 'http://www.w3.org/ns/solid/acp#apply',
}
const ACL_READ_WRITE_CONTROL = 'acl:Read, acl:Write, acl:Control'

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

  const acr = dataGrantTemplate({
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
  }).replaceAll('\n', '')
  const response = await session.fetch(acrId, {
    method: 'PUT',
    body: acr,
    headers: {
      'content-type': 'text/turtle',
    },
  })
  if (!response.ok) {
    throw new Error(`${response.status} - ${acrId}`)
  }
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
  const iris = await linkedIrisJsonLd(registry.id, session.fetch, LDP.contains)
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
 * Rewrite the org's registry-set `.acr` `#fullAdminAccess` access control from
 * the current admin list (idempotent derived rewrite; the org's
 * AuthorizationRegistry is the single source of truth). Refuses to produce an
 * adminless access control — last-admin guard at workflow time.
 */
export async function syncAdminAcr(payload: { webId: SocialAgentId }): Promise<void> {
  const manager = buildSessionManager()
  const session = await manager.getSession(payload.webId.id)

  const admins = await session.adminAuthorizations(session.registrySet.hasAuthorizationRegistry)
  if (admins.length === 0) {
    throw new Error('refusing to write an adminless #fullAdminAccess')
  }

  const matchers: string[] = []
  for (const admin of admins) {
    const uasId = await discoverAuthorizationAgent(admin.grantee, fetch)
    if (!uasId) throw new Error(`no authorization agent for admin: ${admin.grantee}`)
    matchers.push(
      `      [ a acp:Policy;
        acp:allow ${ACL_READ_WRITE_CONTROL};
        acp:anyOf [
          a acp:Matcher;
          acp:agent <${admin.grantee}>;
          acp:client <${uasId}>
        ]
      ]`
    )
  }

  const headResponse = await session.fetch(session.registrySet.id, { method: 'HEAD' })
  const acrId = getAcl(headResponse.headers.get('link'))
  if (!acrId) throw new Error(`no acl link on registry set: ${session.registrySet.id}`)

  const acrResponse = await session.fetch(acrId, { headers: { Accept: 'text/turtle' } })
  const store = await parseTurtle(await acrResponse.text(), acrId)

  // remove the current #fullAdminAccess access control (its policies and matchers)
  const toRemove = new Set<string>()
  for (const quad of store) {
    if (
      quad.predicate.value === 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type' &&
      quad.object.value === acp.AccessControl &&
      quad.subject.value.endsWith('#fullAdminAccess')
    ) {
      toRemove.add(quad.subject.value)
    }
  }
  for (const node of [...toRemove]) {
    for (const quad of store) {
      if (quad.subject.value === node && quad.predicate.value === acp.apply) {
        toRemove.add(quad.object.value)
      }
    }
  }
  for (const node of [...toRemove]) {
    for (const quad of store) {
      if (quad.subject.value === node && quad.predicate.value === acp.anyOf) {
        toRemove.add(quad.object.value)
      }
    }
  }
  for (const quad of [...store]) {
    if (toRemove.has(quad.subject.value)) store.delete(quad)
  }

  const base = await serializeTurtle(store)
  const body = `PREFIX acl: <http://www.w3.org/ns/auth/acl#>
PREFIX acp: <http://www.w3.org/ns/solid/acp#>

${base}
<${acrId}#fullAdminAccess>
  a acp:AccessControl;
  acp:apply
${matchers.join(',\n')}.
`

  const response = await session.fetch(acrId, {
    method: 'PUT',
    body,
    headers: {
      'content-type': 'text/turtle',
    },
  })
  if (!response.ok) {
    throw new Error(`${response.status} - ${acrId}`)
  }
}
