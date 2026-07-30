import {
  type GrantData,
  type FinalGrantData,
  type GeneratedGrants,
  type ReadableDataAuthorization,
  addDataGrant,
  dataGrantTemplate,
  removeAllDataGrants,
  toJsonLd,
} from '@janeirodigital/interop-data-model'
import {
  asyncIterableToArray,
  discoverAuthorizationAgent,
  discoverDelegationIssuanceEndpoint,
  fetchWrapper,
  getAcl,
} from '@janeirodigital/interop-utils'
import { buildSessionManager } from '../../builders/sessionManager.js'

export interface FindAffectedAuthorizationsInput {
  webId: string
  peerId: string
  roleId?: string
}

export interface UpdateGrantsInput {
  webId: string
  authorizationId: string
}

export interface ProcessRoleMembershipChangeInput {
  webId: string
  roleId: string
  peers: string[]
}

export async function findAffectedAuthorizations(
  payload: FindAffectedAuthorizationsInput
): Promise<UpdateGrantsInput[]> {
  const manager = buildSessionManager()
  const session = await manager.getSession(payload.webId)
  const affectedAuthorizations =
    await session.registrySet.hasAuthorizationRegistry.findAuthorizationsDelegatingFromOwner(
      payload.peerId,
      payload.roleId
    )
  return affectedAuthorizations.map((authorization) => ({
    webId: payload.webId,
    authorizationId: authorization.iri,
  }))
}

export interface CreateGrantsInput {
  webId: string
  authorizationId: string
}

export interface CreateGrantsForAgentInput extends CreateGrantsInput {
  grantee: string
}

export interface GetAuthorizationsInput {
  webId: string
  peerId: string
}

export async function getGrantees(payload: CreateGrantsInput): Promise<string[]> {
  const manager = buildSessionManager()
  const session = await manager.getSession(payload.webId)

  const accessAuthorization = await session.factory.readable.accessAuthorization(
    payload.authorizationId
  )

  const agentRegistration = await session.registrySet.hasAgentRegistry.findRegistration(
    accessAuthorization.grantee
  )
  if (agentRegistration) return [agentRegistration.registeredAgent]

  if (session.registrySet.hasRoleRegistry.containedIncludes(accessAuthorization.grantee)) {
    const role = await session.factory.crud.role(accessAuthorization.grantee)
    return role.members
  }
  throw new Error('agent or role registration for the grantee does not exist')
}

export async function getAuthorizations(payload: GetAuthorizationsInput): Promise<string[]> {
  const manager = buildSessionManager()
  const session = await manager.getSession(payload.webId)
  const authorizations = await session.findAuthorizationsForAgent(payload.peerId)
  return authorizations.map((authorization) => authorization.iri)
}

export async function generateGrants(payload: CreateGrantsForAgentInput): Promise<GeneratedGrants> {
  const manager = buildSessionManager()
  const session = await manager.getSession(payload.webId)
  return session.generateDataGrants(payload.authorizationId, payload.grantee)
}

export async function storeDataGrant(payload: FinalGrantData): Promise<void> {
  const manager = buildSessionManager()
  const session = await manager.getSession(payload.dataOwner)

  const body = JSON.stringify(toJsonLd(payload))
  const response = await session.fetch.raw(payload.id, {
    method: 'PUT',
    body,
    headers: {
      'Content-Type': 'application/ld+json',
      'If-None-Match': '*',
    },
  })
  if (!response.ok) throw new Error(`failed to store grant: ${response.status}`)
}

// TODO: DRY with getGrantees
export async function ensurePeers(payload: { webId: string; peersOrRoles: string[] }): Promise<
  string[]
> {
  let peers = new Set<string>()

  const manager = buildSessionManager()
  const session = await manager.getSession(payload.webId)

  for (const peerOrRole of payload.peersOrRoles) {
    const agentRegistration =
      await session.registrySet.hasAgentRegistry.findRegistration(peerOrRole)
    if (agentRegistration) {
      peers.add(peerOrRole)
    } else {
      if (session.registrySet.hasRoleRegistry.containedIncludes(peerOrRole)) {
        const role = await session.factory.crud.role(peerOrRole)
        peers = new Set([...peers, ...role.members])
      }
    }
  }

  return Array.from(peers)
}

export async function deleteAuthorizationsUsingRole(payload: {
  webId: string
  roleId: string
}): Promise<string[]> {
  const manager = buildSessionManager()
  const session = await manager.getSession(payload.webId)
  const authorizations = await asyncIterableToArray(
    await session.registrySet.hasAuthorizationRegistry.accessAuthorizations()
  )
  const grantees = new Set<string>()
  for (const accessAuthorization of authorizations) {
    const dataAuthorizations = await asyncIterableToArray<ReadableDataAuthorization>(
      accessAuthorization.dataAuthorizations
    )
    let toBeDeleted = false
    if (accessAuthorization.grantee === payload.roleId) {
      toBeDeleted = true
    } else {
      // TODO handle authorizations on data from multiple roles
      for (const dataAuthorization of dataAuthorizations) {
        if (dataAuthorization.dataOwner === payload.roleId) {
          toBeDeleted = true
          break
        }
      }
    }
    if (toBeDeleted) {
      grantees.add(accessAuthorization.grantee)
      for (const dataAuthorization of dataAuthorizations) {
        const response = await session.fetch(dataAuthorization.iri, {
          method: 'DELETE',
        })
        if (!response.ok) throw await response.json()
      }
      const response = await session.fetch(accessAuthorization.iri, {
        method: 'DELETE',
      })
      if (!response.ok) throw await response.json()
      await session.registrySet.hasAuthorizationRegistry.remove(accessAuthorization.iri)
    }
    return Array.from(grantees)
  }
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
    uasId = await discoverAuthorizationAgent(payload.grantee, fetchWrapper(fetch))
  } catch {}
  let grantor
  let peer
  let client
  // if grantedBy is a peer also their UAS has write access
  // eg. ACME to Alice, then Alice to Kim
  if (payload.grantedBy !== payload.dataOwner) {
    grantor = {
      agent: payload.grantedBy,
      client: await discoverAuthorizationAgent(payload.grantedBy, fetchWrapper(fetch)),
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
  const headResponse = await session.rawFetch(payload.id, {
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
  const response = await session.rawFetch(acrId, {
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

export async function requestDelegation(payload: { grantData: GrantData }): Promise<string[]> {
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
  return response.json() as Promise<string[]>
}

// ---------------------------------------------------------------------------

export interface SetDataGrantsOnRegistrationInput {
  webId: string
  grantee: string
  grantIris: string[]
}

export async function setDataGrantsOnRegistration(
  payload: SetDataGrantsOnRegistrationInput
): Promise<void> {
  const manager = buildSessionManager()
  const session = await manager.getSession(payload.webId)
  const agentRegistration = await session.registrySet.hasAgentRegistry.findRegistration(
    payload.grantee
  )
  if (!agentRegistration) {
    throw new Error('agent registration for the grantee does not exist')
  }
  for (const grantIri of payload.grantIris) {
    await addDataGrant(agentRegistration, grantIri)
  }
}

export interface ClearDataGrantsOnRegistrationInput {
  webId: string
  peerId: string
}

export async function clearDataGrantsOnRegistration(
  payload: ClearDataGrantsOnRegistrationInput
): Promise<void> {
  const manager = buildSessionManager()
  const session = await manager.getSession(payload.webId)
  const agentRegistration = await session.registrySet.hasAgentRegistry.findRegistration(
    payload.peerId
  )
  if (!agentRegistration) {
    throw new Error('agent registration for the peer does not exist')
  }
  await removeAllDataGrants(agentRegistration)
}
