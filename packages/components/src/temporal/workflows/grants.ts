import type { FinalDataGrantData } from '@janeirodigital/interop-data-model'
import { executeChild, proxyActivities } from '@temporalio/workflow'
import type * as activities from '../activities/grants.js'

const {
  findAffectedAuthorizations,
  deleteAuthorizationsUsingRole,
  getGrantees,
  getAuthorizations,
  clearDataGrantsOnRegistration,
  generateGrants,
  storeDataGrant,
  requestDelegation,
  createAcr,
  setDataGrantsOnRegistration,
  ensurePeers,
} = proxyActivities<typeof activities>({
  startToCloseTimeout: '1 minute',
})

async function storeGrantAndAcr(grant: FinalDataGrantData) {
  await storeDataGrant(grant)
  await createAcr(grant)
}

export async function storeGrant(payload: FinalDataGrantData[]): Promise<void> {
  // TODO same race condition as in createGrantsForAgent — change back to
  // Promise.all after the CSS SPARQL backend dcterms:modified bug is fixed
  for (const grant of payload) {
    await storeGrantAndAcr(grant)
  }
}

export async function updateGrantsForOneAgent(
  payload: activities.GetAuthorizationsInput
): Promise<void> {
  const authorizations = await getAuthorizations(payload)
  if (authorizations.length === 0) {
    await clearDataGrantsOnRegistration(payload)
    return
  }
  await Promise.all(
    // TODO generalize grant creation workflow to handle multiple authorizations
    [authorizations[0]].map((authorizationId) =>
      executeChild(createGrantsForAgent, {
        args: [
          {
            webId: payload.webId,
            grantee: payload.peerId,
            authorizationId,
          },
        ],
      })
    )
  )
}

export async function processRoleDeletion(
  payload: activities.ProcessRoleMembershipChangeInput
): Promise<void> {
  const peersOrRoles = await deleteAuthorizationsUsingRole({
    webId: payload.webId,
    roleId: payload.roleId,
  })
  const peers = await ensurePeers({
    webId: payload.webId,
    peersOrRoles,
  })
  await executeChild(processRoleMembershipChange, {
    args: [
      {
        ...payload,
        peers: [...new Set([...payload.peers, ...peers])],
      },
    ],
  })
}

export async function processRoleMembershipChange(
  payload: activities.ProcessRoleMembershipChangeInput
): Promise<void> {
  await Promise.all(
    payload.peers.map((peerId) =>
      executeChild(updateGrantsForOneAgent, {
        args: [
          {
            webId: payload.webId,
            peerId,
          },
        ],
      })
    )
  )
  const data = { webId: payload.webId, peerId: payload.roleId, roleId: payload.roleId }
  const authorizations = await findAffectedAuthorizations(data)
  await Promise.all(
    authorizations.map((input) =>
      executeChild(updateGrantsForAuthorization, {
        args: [input],
      })
    )
  )
}

export async function createGrantsForAuthorization(
  payload: activities.CreateGrantsInput
): Promise<void> {
  const grantees = await getGrantees(payload)
  await Promise.all(
    grantees.map((grantee) =>
      executeChild(createGrantsForAgent, {
        args: [{ grantee, ...payload }],
      })
    )
  )
}

export async function createGrantsForAgent(
  payload: activities.CreateGrantsForAgentInput
): Promise<void> {
  const generatedGrants = await generateGrants(payload)

  // TODO CSS SPARQL backend has a race condition on dcterms:modified when
  // multiple resources are PUT concurrently in the same container,
  // causing "Multiple results for http://purl.org/dc/terms/modified".
  // Change back to Promise.all after the CSS bug is fixed.
  const allGrantIds: string[] = []
  for (const grant of generatedGrants.sourceGrants) {
    await storeGrantAndAcr(grant)
    allGrantIds.push(grant.id)
  }

  // TODO CSS SPARQL backend has a race condition on dcterms:modified when
  // multiple resources are PUT concurrently in the same container,
  // causing "Multiple results for http://purl.org/dc/terms/modified".
  // Change back to Promise.all after the CSS bug is fixed.
  const delegatedGrantIds = []
  for (const grant of generatedGrants.delegatedGrants) {
    delegatedGrantIds.push(await requestDelegation({ grantData: grant }))
  }

  const allGrantIris = [...allGrantIds, ...delegatedGrantIds.flat()]

  // Clear existing data grants first, then add the new ones
  await clearDataGrantsOnRegistration({
    webId: payload.webId,
    peerId: payload.grantee,
  })

  await setDataGrantsOnRegistration({
    webId: payload.webId,
    grantee: payload.grantee,
    grantIris: allGrantIris,
  })
}

export async function updateDelegatedGrants(
  payload: activities.FindAffectedAuthorizationsInput
): Promise<void> {
  const result = await findAffectedAuthorizations(payload)
  await Promise.all(
    result.map((payload) =>
      executeChild(updateGrantsForAuthorization, {
        args: [payload],
      })
    )
  )
}

export async function updateGrantsForAuthorization(
  payload: activities.UpdateGrantsInput
): Promise<void> {
  await createGrantsForAuthorization({
    webId: payload.webId,
    authorizationId: payload.authorizationId,
  })
}
