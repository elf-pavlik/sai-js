import type { AuthorizationAgent } from '@janeirodigital/interop-authorization-agent'
import {
  ActivityRegistry,
  type ActivityData,
  type AgentId,
  type AgentOrRoleId,
  AgentRegistry,
  type ApplicationRegistrationData,
  AuthorizationRegistry,
  type DataAuthorizationId,
  type FinalGrantData,
  type GeneratedGrants,
  type GrantData,
  type GrantId,
  type RoleId,
  RoleRegistry,
  type SocialAgentId,
  type SocialAgentRegistrationData,
  dataGrantTemplate,
  getDataGrantIris,
  replaceDataGrants,
  toJsonLd,
} from '@janeirodigital/interop-data-model'
import {
  INTEROP,
  discoverAuthorizationAgent,
  discoverDelegationIssuanceEndpoint,
  expandedJsonLd,
  getAcl,
} from '@janeirodigital/interop-utils'
import { buildSessionManager } from '../../builders/sessionManager.js'

export interface FindAffectedAuthorizationsInput {
  webId: SocialAgentId
  peerId: SocialAgentId
  roleId?: RoleId
  /** IRI of the activity that triggered this workflow — marked done on success */
  activityIri?: string
}

export interface CreateGrantsInput {
  webId: SocialAgentId
  authorizationGrantee: AgentOrRoleId
}

export interface CreateGrantsForAgentInput {
  webId: SocialAgentId
  grantee: AgentId
}

export interface GenerateGrantsInput {
  webId: SocialAgentId
  grantee: AgentId
  dataAuthorizations: DataAuthorizationId[]
}

export interface GetAuthorizationsInput {
  webId: SocialAgentId
  peerId: AgentId
}

export interface ProcessRoleMembershipChangeInput {
  webId: SocialAgentId
  roleId: RoleId
  peers: SocialAgentId[]
  /** IRI of the activity that triggered this workflow — marked done on success */
  activityIri?: string
}

export interface RoleUsage {
  usedAsGrantee: boolean
  affectedGrantees: AgentOrRoleId[]
  authorizations: DataAuthorizationId[]
}

export interface CheckEquivalenceInput {
  webId: SocialAgentId
  grantee: AgentId
  generated: GeneratedGrants
  existing: GrantData[]
}

export interface EquivalenceResult {
  reused: { existing: GrantId; generated: GrantData }[]
}

// ---------------------------------------------------------------------------
// Typing helpers — producers determine `type`, consumers branch on it
// ---------------------------------------------------------------------------

/** Type an agent id from its agent registration (SocialAgent vs Application). */
function agentIdFromRegistration(
  registration: ApplicationRegistrationData | SocialAgentRegistrationData
): AgentId {
  return {
    id: registration.registeredAgent,
    type: registration.type.includes(INTEROP.ApplicationRegistration)
      ? [INTEROP.Application]
      : [INTEROP.SocialAgent],
  }
}

/**
 * Type a grantee IRI as `AgentOrRoleId` (Role → role id, else agent id) using
 * the same lookups the removed `ensurePeers` performed.
 */
async function typeGrantee(session: AuthorizationAgent, iri: string): Promise<AgentOrRoleId> {
  const agentRegistration = await AgentRegistry.findRegistration(
    session.registrySet.hasAgentRegistry,
    session.factory,
    iri
  )
  if (agentRegistration) return agentIdFromRegistration(agentRegistration)

  if (
    await RoleRegistry.containedIncludes(session.registrySet.hasRoleRegistry, session.factory, iri)
  ) {
    return { id: iri, type: [INTEROP.Role] }
  }
  throw new Error('agent or role registration for the grantee does not exist')
}

// ---------------------------------------------------------------------------
// Authorization → grantee resolution
// ---------------------------------------------------------------------------

/**
 * Ports the existing matching of `findAffectedAuthorizations`
 * (`findAuthorizationsDelegatingFromOwner` with optional roleId; when roleId
 * is undefined — `updateDelegatedGrants` — the existing logic also matches
 * All-scope authorizations) but returns the deduped grantees (typed, may
 * include roles) instead of grouping by grantee with iris.
 */
export async function findAffectedGrantees(
  payload: FindAffectedAuthorizationsInput
): Promise<AgentOrRoleId[]> {
  const manager = buildSessionManager()
  const session = await manager.getSession(payload.webId.id)
  const dataAuthorizations = await AuthorizationRegistry.findAuthorizationsDelegatingFromOwner(
    session.registrySet.hasAuthorizationRegistry,
    session.factory,
    payload.peerId.id,
    payload.roleId?.id
  )
  const grantees: AgentOrRoleId[] = []
  const seen = new Set<string>()
  for (const dataAuthorization of dataAuthorizations) {
    const grantee = dataAuthorization.grantee
    if (seen.has(grantee)) continue
    seen.add(grantee)
    grantees.push(await typeGrantee(session, grantee))
  }
  return grantees
}

/**
 * How a role is used across authorizations (single scan).
 *
 * dataOwner matching mirrors `findAuthorizationsDelegatingFromOwner`:
 * dataOwner === roleId && grantee !== roleId (an authorization granted TO the
 * role itself is not also a dataOwner-authorization of that same role).
 * `usedAsDataOwner` is derived: `affectedGrantees.length > 0`.
 * The producer types each grantee (SocialAgentId | ApplicationId | RoleId).
 */
export async function findRoleUsage(payload: {
  webId: SocialAgentId
  roleId: RoleId
}): Promise<RoleUsage> {
  const manager = buildSessionManager()
  const session = await manager.getSession(payload.webId.id)
  const roleId = payload.roleId.id
  let usedAsGrantee = false
  const affectedGrantees: AgentOrRoleId[] = []
  const authorizations: DataAuthorizationId[] = []
  const seenAuthorizations = new Set<string>()
  const seenGrantees = new Set<string>()
  for await (const dataAuthorization of AuthorizationRegistry.dataAuthorizations(
    session.registrySet.hasAuthorizationRegistry,
    session.factory
  )) {
    const grantee = dataAuthorization.grantee
    const isGranteeMatch = grantee === roleId
    const isDataOwnerMatch = dataAuthorization.dataOwner === roleId && grantee !== roleId
    if (!isGranteeMatch && !isDataOwnerMatch) continue
    if (!seenAuthorizations.has(dataAuthorization.id!)) {
      seenAuthorizations.add(dataAuthorization.id!)
      authorizations.push({ id: dataAuthorization.id, type: dataAuthorization.type })
    }
    if (isGranteeMatch) usedAsGrantee = true
    if (isDataOwnerMatch && !seenGrantees.has(grantee)) {
      seenGrantees.add(grantee)
      affectedGrantees.push(await typeGrantee(session, grantee))
    }
  }
  return { usedAsGrantee, affectedGrantees, authorizations }
}

// ---------------------------------------------------------------------------
// Role resolution
// ---------------------------------------------------------------------------

/** Routes by type: Role → its members, agent types → [grantee] as-is. */
export async function getGrantees(payload: {
  webId: SocialAgentId
  grantee: AgentOrRoleId
}): Promise<AgentId[]> {
  if (payload.grantee.type.includes(INTEROP.Role)) {
    const manager = buildSessionManager()
    const session = await manager.getSession(payload.webId.id)
    const role = await session.factory.role(payload.grantee.id)
    return role.members.map((member) => ({ id: member, type: [INTEROP.SocialAgent] }))
  }
  return [payload.grantee as AgentId]
}

// ---------------------------------------------------------------------------
// Authorization fetching / grant generation
// ---------------------------------------------------------------------------

/** All authorizations for the grantee (incl. via roles), typed. */
export async function getAuthorizations(
  payload: GetAuthorizationsInput
): Promise<DataAuthorizationId[]> {
  const manager = buildSessionManager()
  const session = await manager.getSession(payload.webId.id)
  const authorizations = await session.findAuthorizationsForAgent(payload.peerId.id)
  return authorizations.map((dataAuthorization) => ({
    id: dataAuthorization.id,
    type: dataAuthorization.type,
  }))
}

/** Generate grants from the given data authorizations. */
export async function generateGrants(payload: GenerateGrantsInput): Promise<GeneratedGrants> {
  const manager = buildSessionManager()
  const session = await manager.getSession(payload.webId.id)
  return session.generateDataGrants(
    payload.dataAuthorizations.map((dataAuthorization) => dataAuthorization.id!),
    payload.grantee.id
  )
}

// ---------------------------------------------------------------------------
// Existing grants
// ---------------------------------------------------------------------------

/**
 * Read the grantee's current grants from their agent registration (hasDataGrant).
 *
 * Returns [] when the registration has no grants; tolerates grants that no
 * longer exist (already deleted at the data owner). (Registration itself is
 * guaranteed to exist — see plan design decision 8.)
 */
export async function getExistingGrants(payload: {
  webId: SocialAgentId
  peerId: AgentId
}): Promise<GrantData[]> {
  const manager = buildSessionManager()
  const session = await manager.getSession(payload.webId.id)
  const agentRegistration = await AgentRegistry.findRegistration(
    session.registrySet.hasAgentRegistry,
    session.factory,
    payload.peerId.id
  )
  if (!agentRegistration) {
    throw new Error('agent registration for the peer does not exist')
  }
  const grants: GrantData[] = []
  for (const grantIri of await getDataGrantIris(agentRegistration)) {
    try {
      grants.push(await session.factory.dataGrant(grantIri))
    } catch {
      // grant resource no longer exists (already deleted at the data owner) — tolerate
    }
  }
  return grants
}

/**
 * HTTP-DELETE grant resources using the webId's session.
 *
 * Works for source grants (in the webId's own registry) AND delegated grants
 * (in data owners' registries — the dataGrantTemplate ACR grants the grantor
 * acl:Write, which CSS maps to the Delete permission).
 * Idempotent: 404 is tolerated (already gone).
 */
export async function deleteDataGrants(payload: {
  webId: SocialAgentId
  grants: GrantId[]
}): Promise<void> {
  const manager = buildSessionManager()
  const session = await manager.getSession(payload.webId.id)
  // TODO CSS SPARQL backend has a race condition on dcterms:modified when
  // multiple resources are PUT concurrently in the same container,
  // causing "Multiple results for http://purl.org/dc/terms/modified".
  // Change back to Promise.all after the CSS bug is fixed.
  for (const grant of payload.grants) {
    const response = await session.fetch(grant.id!, { method: 'DELETE' })
    if (!response.ok && response.status !== 404) {
      throw new Error(`failed to delete grant: ${response.status}`)
    }
  }
}

// ---------------------------------------------------------------------------
// Equivalence (dummy for now)
// ---------------------------------------------------------------------------

/**
 * DUMMY for now: always returns { reused: [] } (pretend nothing is equivalent).
 * Interface ready for the real comparison (see plan "Future step").
 */
export async function checkEquivalence(
  _payload: CheckEquivalenceInput
): Promise<EquivalenceResult> {
  return { reused: [] }
}

// ---------------------------------------------------------------------------
// Deletion of data authorizations
// ---------------------------------------------------------------------------

/**
 * Separate deletion step — deletes the authorization resources whose IRIs come
 * from `findRoleUsage().authorizations` (replaces `deleteAuthorizationsUsingRole`:
 * usage scanning is findRoleUsage's job, deletion is this activity's job).
 * Idempotent: 404 is tolerated (already deleted).
 */
export async function deleteAuthorizations(payload: {
  webId: SocialAgentId
  authorizations: DataAuthorizationId[]
}): Promise<void> {
  const manager = buildSessionManager()
  const session = await manager.getSession(payload.webId.id)
  // TODO CSS SPARQL backend has a race condition on dcterms:modified when
  // multiple resources are PUT concurrently in the same container,
  // causing "Multiple results for http://purl.org/dc/terms/modified".
  // Change back to Promise.all after the CSS bug is fixed.
  for (const authorization of payload.authorizations) {
    const response = await session.fetch(authorization.id!, { method: 'DELETE' })
    if (!response.ok && response.status !== 404) {
      throw new Error(`failed to delete data authorization: ${response.status}`)
    }
  }
}

// ---------------------------------------------------------------------------
// Storing grants (unchanged)
// ---------------------------------------------------------------------------

export async function storeDataGrant(payload: FinalGrantData): Promise<void> {
  const manager = buildSessionManager()
  const session = await manager.getSession(payload.dataOwner)

  const body = JSON.stringify(await expandedJsonLd(toJsonLd(payload)))
  const response = await session.fetch(payload.id, {
    method: 'PUT',
    body,
    headers: {
      'Content-Type': 'application/ld+json',
      'If-None-Match': '*',
    },
  })
  if (!response.ok) throw new Error(`failed to store grant: ${response.status}`)
}

/*
 * 1. owner grants to a peer
 * 2. owner grants to an application
 * 3. grantor grants to a peer (delegation)
 * 4. grantor grants to an application (delegation)
 */
export async function createAcr(payload: FinalGrantData): Promise<void> {
  const manager = buildSessionManager()
  const session = await manager.getSession(payload.dataOwner)
  // TODO: improve error handling
  let uasId
  try {
    uasId = await discoverAuthorizationAgent(payload.grantee, fetch)
  } catch {}
  let grantor
  let peer
  let client
  // if grantedBy is a peer also their UAS has write access
  // eg. ACME to Alice, then Alice to Kim
  if (payload.grantedBy !== payload.dataOwner) {
    grantor = {
      agent: payload.grantedBy,
      client: await discoverAuthorizationAgent(payload.grantedBy, fetch),
    }
  }
  if (uasId) {
    // no self granting at this moment!
    if (payload.grantee === payload.dataOwner) throw payload

    // grantee is a social agent - only their UAS has access
    peer = {
      agent: payload.grantee,
      client: uasId,
    }
  } else {
    // grantee is an application - used by the grantedBy
    client = {
      agent: payload.grantedBy,
      client: payload.grantee,
    }
  }
  if (!peer && !client) throw new Error('peer or client are required')
  const headResponse = await session.fetch(payload.id, {
    method: 'HEAD',
  })
  const acrId = getAcl(headResponse.headers.get('link'))
  const acr = dataGrantTemplate({
    id: acrId,
    resource: payload.id,
    owner: {
      agent: session.webId,
      client: session.agentId,
    },
    grantor,
    peer,
    client,
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

/** Request delegated grants from the data owner; returns the assigned GrantIds. */
export async function requestDelegation(payload: { grantData: GrantData }): Promise<GrantId[]> {
  const manager = buildSessionManager()
  const session = await manager.getSession(payload.grantData.grantedBy)

  // TODO: do discovery in previous workflow step and pass endpoint in activity payload
  const endpoint = await discoverDelegationIssuanceEndpoint(
    payload.grantData.dataOwner,
    session.fetch
  )
  const response = await session.fetch(endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(payload.grantData),
  })
  if (!response.ok) {
    throw new Error(await response.json())
  }
  if (response.status !== 200) {
    throw new Error(`expected 200 but received ${response.status}`)
  }
  const iris = (await response.json()) as string[]
  return iris.map((id) => ({ id, type: [INTEROP.DataGrant] }))
}

// ---------------------------------------------------------------------------
// Registration link/unlink
// ---------------------------------------------------------------------------

export interface ReplaceDataGrantsOnRegistrationInput {
  webId: SocialAgentId
  grantee: AgentId
  grants: GrantId[]
}

/**
 * Set the grantee's registration hasDataGrant links to exactly `grants` in a
 * single PATCH (remove old + insert new) → exactly one Update notification on
 * the registration. Deny case: `grants: []`.
 */
export async function replaceDataGrantsOnRegistration(
  payload: ReplaceDataGrantsOnRegistrationInput
): Promise<void> {
  const manager = buildSessionManager()
  const session = await manager.getSession(payload.webId.id)
  const agentRegistration = await AgentRegistry.findRegistration(
    session.registrySet.hasAgentRegistry,
    session.factory,
    payload.grantee.id
  )
  if (!agentRegistration) {
    throw new Error('agent registration for the grantee does not exist')
  }
  await replaceDataGrants(
    agentRegistration,
    session.factory,
    payload.grants.map((grant) => grant.id!)
  )
}

// ---------------------------------------------------------------------------
// Per-target consumer (Phase 4.1): drain + coalesce authorization activities
// ---------------------------------------------------------------------------

export interface GetPendingGranteeActivitiesInput {
  webId: SocialAgentId
  authorizationGrantee: AgentOrRoleId
}

/**
 * The pending authorizationRecorded/authorizationRevoked activities targeting
 * the given grantee in the activity registry (not yet completed).
 */
export async function getPendingGranteeActivities(
  payload: GetPendingGranteeActivitiesInput
): Promise<ActivityData[]> {
  const manager = buildSessionManager()
  const session = await manager.getSession(payload.webId.id)
  const registry = session.registrySet.hasActivityRegistry
  if (!registry) return []
  const iris = await ActivityRegistry.getActivityIris(registry, session.factory)
  // one pass: partition completions into a completed-set, keep typed work items
  const workItems: ActivityData[] = []
  const completed = new Set<string>()
  for (const iri of iris) {
    const activity = await ActivityRegistry.loadActivity(iri, session.factory)
    if (activity.activityType === 'activityCompleted') {
      completed.add(activity.target)
      continue
    }
    if (
      activity.activityType !== 'authorizationRecorded' &&
      activity.activityType !== 'authorizationRevoked'
    )
      continue
    const grantee = (activity.payload as { authorizationGrantee?: { id: string } } | undefined)
      ?.authorizationGrantee
    if (!grantee || grantee.id !== payload.authorizationGrantee.id) continue
    workItems.push(activity)
  }
  return workItems.filter((activity) => !completed.has(activity.id))
}

export interface GetPendingActivitiesInput {
  webId: SocialAgentId
}

/**
 * All pending activities (any non-completion type, no completion referencing
 * them) in the webId's activity registry.
 */
export async function getPendingActivities(
  payload: GetPendingActivitiesInput
): Promise<ActivityData[]> {
  const manager = buildSessionManager()
  const session = await manager.getSession(payload.webId.id)
  const registry = session.registrySet.hasActivityRegistry
  if (!registry) return []
  const iris = await ActivityRegistry.getActivityIris(registry, session.factory)
  // one pass: partition completions into a completed-set, keep the rest
  const workItems: ActivityData[] = []
  const completed = new Set<string>()
  for (const iri of iris) {
    const activity = await ActivityRegistry.loadActivity(iri, session.factory)
    if (activity.activityType === 'activityCompleted') {
      completed.add(activity.target)
    } else {
      workItems.push(activity)
    }
  }
  return workItems.filter((activity) => !completed.has(activity.id))
}

export interface MarkActivitiesDoneInput {
  webId: SocialAgentId
  activities: ActivityData[]
}

/** Mark the given activities done (one minimal completion activity each). */
export async function markActivitiesDone(payload: MarkActivitiesDoneInput): Promise<void> {
  const manager = buildSessionManager()
  const session = await manager.getSession(payload.webId.id)
  const registry = session.registrySet.hasActivityRegistry
  if (!registry) return
  for (const activity of payload.activities) {
    await ActivityRegistry.createCompletion(registry, session.factory, activity.id)
  }
}
