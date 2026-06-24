import type { FinalAccessGrantData, FinalDataGrantData } from '@janeirodigital/interop-data-model'
import { proxyActivities, startChild } from '@temporalio/workflow'
import type * as activities from '../activities/grants.js'

const {
  findAffectedAuthorizations,
  getGrantees,
  getAuthorizations,
  unsetAccessGrant,
  generateGrants,
  storeDataGrant,
  requestDelegation,
  createAcr,
  storeAccessGrant,
  setAccessGrant,
} = proxyActivities<typeof activities>({
  startToCloseTimeout: '1 minute',
})

async function storeGrantAndAcr(grant: FinalDataGrantData) {
  await storeDataGrant(grant)
  await createAcr(grant)
}

export async function storeGrant(payload: FinalDataGrantData[]): Promise<void> {
  await Promise.all(payload.map((grant) => storeGrantAndAcr(grant)))
}

export async function updateGrantsForOneAgent(
  payload: activities.GetAuthorizationsInput
): Promise<void> {
  const authorizations = await getAuthorizations(payload)
  // TODO change when we remove access grant
  if (authorizations.length === 0) {
    await unsetAccessGrant(payload)
    return
  }
  await Promise.all(
    // TODO generalize grant creation workflow to handle multiple authorizations
    [authorizations[0]].map((authorizationId) =>
      startChild(createGrantsForAgent, {
        args: [
          {
            webId: payload.webId,
            grantee: payload.peerId,
            authorizationId,
          },
        ],
        parentClosePolicy: 'ABANDON',
      })
    )
  )
}

export async function updateGrantsForAgents(
  payload: activities.UpdateGrantsForAgentsInput
): Promise<void> {
  await Promise.all(
    payload.peers.map((peerId) =>
      startChild(updateGrantsForOneAgent, {
        args: [
          {
            webId: payload.webId,
            peerId,
          },
        ],
        parentClosePolicy: 'ABANDON',
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
      startChild(createGrantsForAgent, {
        args: [{ grantee, ...payload }],
        parentClosePolicy: 'ABANDON',
      })
    )
  )
}

export async function createGrantsForAgent(
  payload: activities.CreateGrantsForAgentInput
): Promise<void> {
  const accessGrantData = await generateGrants(payload)

  await Promise.all(accessGrantData.sourceGrants.map((grant) => storeGrantAndAcr(grant)))

  const delegatedGrantIds = await Promise.all(
    // if grant has inheriting it delegation will return a flat array with all the ids
    accessGrantData.delegatedGrants.map((grant) => requestDelegation({ grantData: grant }))
  )

  // TODO: use ids only for dataGrants at this point
  const finalAccessGrantData: FinalAccessGrantData = {
    ...accessGrantData,
    dataGrants: [...accessGrantData.sourceGrants.map((g) => g.id), ...delegatedGrantIds.flat()],
  }

  await storeAccessGrant(finalAccessGrantData)
  await setAccessGrant(finalAccessGrantData)
}

export async function updateDelegatedGrants(
  payload: activities.FindAffectedAuthorizationsInput
): Promise<void> {
  const result = await findAffectedAuthorizations(payload)
  await Promise.all(
    result.map((payload) =>
      startChild(updateGrantsForAuthorization, {
        args: [payload],
        parentClosePolicy: 'ABANDON',
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
