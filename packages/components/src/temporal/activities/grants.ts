import type { AuthorizationAgent } from '@janeirodigital/interop-authorization-agent'
import type { RoleUsage } from '@janeirodigital/interop-authorization-agent'
import {
  type AccessRequestMessage,
  type ActivityData,
  ActivityRegistry,
  type AgentId,
  type AgentOrRoleId,
  AgentRegistry,
  type DataAuthorizationId,
  type FinalGrantData,
  type GeneratedGrants,
  type GrantData,
  type GrantId,
  type IncomingGrantData,
  type RoleId,
  type SocialAgentId,
  dataGrantTemplate,
  getDataGrantIris,
  loadGrant,
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
// Authorization → grantee resolution
// ---------------------------------------------------------------------------

/**
 * Ports the match semantics of `findAuthorizationsDelegatingFromOwner`
 * (replicated over the registry-plane listing, docs/sparql.md candidate 3;
 * with optional roleId — when roleId is undefined, `updateDelegatedGrants` —
 * the logic also matches All-scope authorizations) and returns the deduped
 * grantees (typed, may include roles).
 */
export async function findAffectedGrantees(
  payload: FindAffectedAuthorizationsInput
): Promise<AgentOrRoleId[]> {
  const manager = buildSessionManager()
  const session = await manager.getSession(payload.webId.id)
  // the match semantics live in the AA session method (relocated Phase 4)
  return session.findAffectedGrantees(payload.peerId.id, payload.roleId?.id)
}

export async function findRoleUsage(payload: {
  webId: SocialAgentId
  roleId: RoleId
}): Promise<RoleUsage> {
  const manager = buildSessionManager()
  const session = await manager.getSession(payload.webId.id)
  // role usage scanning lives in the AA session method (relocated Phase 4)
  return session.findRoleUsage(payload.roleId.id)
}

// ---------------------------------------------------------------------------
// Role resolution
// ---------------------------------------------------------------------------

/** Routes by type: Role → its members, agent types → [grantee] as-is. */
export async function getGrantees(payload: {
  webId: SocialAgentId
  grantee: AgentOrRoleId
}): Promise<AgentId[]> {
  const manager = buildSessionManager()
  const session = await manager.getSession(payload.webId.id)
  // role → members routing lives in the AA session method (relocated Phase 4)
  return session.getGrantees(payload.grantee)
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
    session.fetch,
    payload.peerId.id
  )
  if (!agentRegistration) {
    throw new Error('agent registration for the peer does not exist')
  }
  const grants: GrantData[] = []
  for (const grantIri of await getDataGrantIris(agentRegistration)) {
    try {
      grants.push(await loadGrant(grantIri, session.fetch))
    } catch {
      // grant resource no longer exists (already deleted at the data owner) — tolerate
    }
  }
  return grants
}

/**
 * HTTP-DELETE grant resources using the webId's session.
 *
 * Internal to the data owner's revocation handler only (DD14): the
 * dataGrantTemplate ACR is read-only for everyone but the owner, so a
 * grantor's direct DELETE of grant resources in another peer's registry is
 * ACR-blocked. Idempotent: 404 is tolerated (already gone).
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
  // the delegation endpoint takes an interop:AccessRequest envelope (§3)
  const message: AccessRequestMessage = {
    type: [INTEROP.AccessRequest],
    grants: [payload.grantData as unknown as IncomingGrantData],
  }
  const response = await session.fetch(endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(message),
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

export interface RequestGrantRevocationInput {
  webId: SocialAgentId
  dataOwner: string
  grants: GrantId[]
}

export interface ProcessGrantsRevocationInput {
  webId: SocialAgentId
  grantee: AgentId
  dataOwner: string
  grants: GrantId[]
  /** IRI of the activity that triggered this workflow — marked done on success */
  activityIri?: string
}

/**
 * POST an interop:AccessRevocation to the data owner's delegation endpoint
 * (mirror of requestDelegation). The response echoes the removed grant IRIs;
 * the requester's registration cleanup happens in the workflow after this
 * succeeds.
 */
export async function requestGrantRevocation(payload: RequestGrantRevocationInput): Promise<void> {
  const manager = buildSessionManager()
  const session = await manager.getSession(payload.webId.id)

  const endpoint = await discoverDelegationIssuanceEndpoint(payload.dataOwner, session.fetch)
  const response = await session.fetch(endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      type: [INTEROP.AccessRevocation],
      grants: payload.grants.map((grant) => grant.id!),
    }),
  })
  if (!response.ok) {
    throw new Error(await response.text())
  }
  if (response.status !== 200) {
    throw new Error(`expected 200 but received ${response.status}`)
  }
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
    session.fetch,
    payload.grantee.id
  )
  if (!agentRegistration) {
    throw new Error('agent registration for the grantee does not exist')
  }
  await replaceDataGrants(
    agentRegistration,
    session.fetch,
    payload.grants.map((grant) => grant.id!)
  )
}

export interface RemoveDataGrantsFromRegistrationInput {
  webId: SocialAgentId
  grantee: AgentId
  grants: GrantId[]
}

/**
 * Remove the given grant IRIs from the grantee's registration `hasDataGrant`
 * links — the requester hop: the grantor clears its projection after the
 * revocation response (§5 System 1). Rewrites the links via the regeneration
 * path's proven single-PATCH replacement (`replaceDataGrants`), so the removal
 * never takes the delete-only `removeDataGrant` route.
 */
export async function removeDataGrantsFromRegistration(
  payload: RemoveDataGrantsFromRegistrationInput
): Promise<void> {
  const manager = buildSessionManager()
  const session = await manager.getSession(payload.webId.id)
  await session.removeGrantsFromRegistration(
    payload.grantee.id,
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
  const iris = await ActivityRegistry.getActivityIris(registry, session.fetch)
  // one pass: partition completions into a completed-set, keep typed work items
  const workItems: ActivityData[] = []
  const completed = new Set<string>()
  for (const iri of iris) {
    const activity = await ActivityRegistry.loadActivity(iri, session.fetch)
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
  const iris = await ActivityRegistry.getActivityIris(registry, session.fetch)
  // one pass: partition completions into a completed-set, keep the rest
  const workItems: ActivityData[] = []
  const completed = new Set<string>()
  for (const iri of iris) {
    const activity = await ActivityRegistry.loadActivity(iri, session.fetch)
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
    await ActivityRegistry.createCompletion(
      registry,
      { fetch: session.fetch, randomUUID: session.randomUUID },
      activity.id
    )
  }
}
