import type { AgentId, FinalGrantData, GrantId } from '@janeirodigital/interop-data-model'
import { executeChild, proxyActivities } from '@temporalio/workflow'
import type * as activities from '../activities/grants.js'

// NOTE: workflow code runs inside the Temporal sandbox — no runtime imports
// beyond @temporalio/workflow (utils' INTEROP would pull in disallowed Node
// built-ins). The value must match what producers put in `RoleId.type`.
const ROLE_TYPE = 'http://www.w3.org/ns/solid/interop#Role'

const {
  findAffectedGrantees,
  getGrantees,
  getAuthorizations,
  getExistingGrants,
  generateGrants,
  checkEquivalence,
  deleteDataGrants,
  deleteAuthorizations,
  findRoleUsage,
  storeDataGrant,
  createAcr,
  requestDelegation,
  replaceDataGrantsOnRegistration,
} = proxyActivities<typeof activities>({
  startToCloseTimeout: '1 minute',
})

async function storeGrantAndAcr(grant: FinalGrantData) {
  await storeDataGrant(grant)
  await createAcr(grant)
}

export async function storeGrant(payload: FinalGrantData[]): Promise<void> {
  // TODO same race condition as in createGrantsForAgent — change back to
  // Promise.all after the CSS SPARQL backend dcterms:modified bug is fixed
  for (const grant of payload) {
    await storeGrantAndAcr(grant)
  }
}

export async function createGrantsForAuthorization(
  payload: activities.CreateGrantsInput
): Promise<void> {
  const grantees = await getGrantees({
    webId: payload.webId,
    grantee: payload.authorizationGrantee,
  })
  await Promise.all(
    grantees.map((grantee) =>
      executeChild(createGrantsForAgent, {
        args: [
          {
            webId: payload.webId,
            grantee,
          },
        ],
      })
    )
  )
}

export async function updateDelegatedGrants(
  payload: activities.FindAffectedAuthorizationsInput
): Promise<void> {
  const grantees = await findAffectedGrantees(payload)
  await Promise.all(
    grantees.map((authorizationGrantee) =>
      executeChild(createGrantsForAuthorization, {
        args: [
          {
            webId: payload.webId,
            authorizationGrantee,
          },
        ],
      })
    )
  )
}

export async function processRoleMembershipChange(
  payload: activities.ProcessRoleMembershipChangeInput
): Promise<void> {
  const usage = await findRoleUsage({ webId: payload.webId, roleId: payload.roleId })
  const affected: AgentId[] = []
  const seen = new Set<string>()
  const add = (agent: AgentId) => {
    if (seen.has(agent.id)) return
    seen.add(agent.id)
    affected.push(agent)
  }
  // role used as grantee → changed members' received grants changed
  if (usage.usedAsGrantee) {
    for (const peer of payload.peers) add(peer)
  }
  // role used as dataOwner → the *grantees of those authorizations* are affected
  for (const grantee of usage.affectedGrantees) {
    if (grantee.type.includes(ROLE_TYPE)) {
      const members = await getGrantees({ webId: payload.webId, grantee })
      for (const member of members) add(member)
    } else {
      add(grantee as AgentId)
    }
  }
  await Promise.all(
    affected.map((grantee) =>
      executeChild(createGrantsForAgent, {
        args: [
          {
            webId: payload.webId,
            grantee,
          },
        ],
      })
    )
  )
}

export async function processRoleDeletion(
  payload: activities.ProcessRoleMembershipChangeInput
): Promise<void> {
  // scan BEFORE deletion — the usage info and the matched authorization ids
  // must be captured while the authorizations still exist
  const usage = await findRoleUsage({ webId: payload.webId, roleId: payload.roleId })
  await deleteAuthorizations({
    webId: payload.webId,
    authorizations: usage.authorizations,
  })
  const affected: AgentId[] = []
  const seen = new Set<string>()
  const add = (agent: AgentId) => {
    if (seen.has(agent.id)) return
    seen.add(agent.id)
    affected.push(agent)
  }
  // role.members ARE the grantees of grantee-authorizations; unresolvable
  // after deletion (role resource gone) → must come from the service
  if (usage.usedAsGrantee) {
    for (const peer of payload.peers) add(peer)
  }
  // grantees of dataOwner-authorizations — route by type
  for (const grantee of usage.affectedGrantees) {
    if (grantee.type.includes(ROLE_TYPE)) {
      const members = await getGrantees({ webId: payload.webId, grantee })
      for (const member of members) add(member)
    } else {
      add(grantee as AgentId)
    }
  }
  await Promise.all(
    affected.map((grantee) =>
      executeChild(createGrantsForAgent, {
        args: [
          {
            webId: payload.webId,
            grantee,
          },
        ],
      })
    )
  )
}

export async function createGrantsForAgent(
  payload: activities.CreateGrantsForAgentInput
): Promise<void> {
  // SELF-CONTAINED: fetch ALL of the grantee's authorizations (incl. via roles)
  const authorizations = await getAuthorizations({
    webId: payload.webId,
    peerId: payload.grantee,
  })
  const existing = await getExistingGrants({ webId: payload.webId, peerId: payload.grantee })

  // deny case — no authorizations: clear all existing grants + registration
  if (authorizations.length === 0) {
    // await deleteDataGrants({
    //   webId: payload.webId,
    //   grants: existing.map((grant) => ({ id: grant.id!, type: grant.type })),
    // })
    await replaceDataGrantsOnRegistration({
      webId: payload.webId,
      grantee: payload.grantee,
      grants: [],
    })
    return
  }

  const generated = await generateGrants({
    webId: payload.webId,
    grantee: payload.grantee,
    dataAuthorizations: authorizations,
  })
  // DUMMY for now → { reused: [] }; the workflow is fully wired for the real check
  const { reused } = await checkEquivalence({
    webId: payload.webId,
    grantee: payload.grantee,
    generated,
    existing,
  })
  const reusedGenerated = new Set(reused.map((entry) => entry.generated))

  // TODO CSS SPARQL backend has a race condition on dcterms:modified when
  // multiple resources are PUT concurrently in the same container,
  // causing "Multiple results for http://purl.org/dc/terms/modified".
  // Change back to Promise.all after the CSS bug is fixed.
  const newGrantIds: GrantId[] = []
  for (const grant of generated.sourceGrants) {
    if (reusedGenerated.has(grant)) continue
    await storeGrantAndAcr(grant)
    newGrantIds.push({ id: grant.id, type: grant.type })
  }

  // TODO CSS SPARQL backend has a race condition on dcterms:modified when
  // multiple resources are PUT concurrently in the same container,
  // causing "Multiple results for http://purl.org/dc/terms/modified".
  // Change back to Promise.all after the CSS bug is fixed.
  for (const grant of generated.delegatedGrants) {
    if (reusedGenerated.has(grant)) continue
    const delegatedGrantIds = await requestDelegation({ grantData: grant })
    newGrantIds.push(...delegatedGrantIds)
  }

  // delete the old grant resources that are not reused
  const reusedExistingIds = new Set(reused.map((entry) => entry.existing.id))
  // await deleteDataGrants({
  //   webId: payload.webId,
  //   grants: existing
  //     .filter((grant) => !reusedExistingIds.has(grant.id))
  //     .map((grant) => ({ id: grant.id!, type: grant.type })),
  // })

  await replaceDataGrantsOnRegistration({
    webId: payload.webId,
    grantee: payload.grantee,
    grants: [...newGrantIds, ...reused.map((entry) => entry.existing)],
  })
}
