import type {
  AgentId,
  ActivityData,
  FinalGrantData,
  GrantId,
  GrantsRevoked,
  InvitationCreated,
  RoleDeleted,
  RoleMembershipChanged,
  SocialAgentId,
} from '@janeirodigital/interop-data-model'
import { WorkflowExecutionAlreadyStartedError } from '@temporalio/common'
import {
  condition,
  defineSignal,
  executeChild,
  proxyActivities,
  setHandler,
} from '@temporalio/workflow'
import type * as activities from '../activities/grants.js'
import { createAdminGrants, revokeAdminGrants, syncAdminAcr } from './admin.js'
import type { AdminWorkflowInput } from './admin.js'
import { createInvitation } from './invitation.js'

// NOTE: workflow code runs inside the Temporal sandbox — no runtime imports
// beyond @temporalio/workflow (utils' INTEROP would pull in disallowed Node
// built-ins). The values must match what producers put in the refs they build.
const ROLE_TYPE = 'http://www.w3.org/ns/solid/interop#Role'
const SOCIAL_AGENT_TYPE = 'http://www.w3.org/ns/solid/interop#SocialAgent'
const SOCIAL_AGENT_INVITATION_TYPE = 'http://www.w3.org/ns/solid/interop#SocialAgentInvitation'
const DATA_GRANT_TYPE = 'http://www.w3.org/ns/solid/interop#DataGrant'

/** Sandbox-safe discriminant check (the data-model `isActivityClass` helper
 * is a runtime import — not allowed here; the tuples are read as string[]). */
function isActivityClass(activity: ActivityData, cls: string): boolean {
  return (activity.type as readonly string[]).includes(cls)
}

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
  removeDataGrantsFromRegistration,
  requestDelegation,
  requestGrantRevocation,
  replaceDataGrantsOnRegistration,
  getPendingGranteeActivities,
  getPendingActivities,
  resolveActivityGrantee,
  markActivitiesDone,
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

/**
 * Revoke grants in the data owner's registry: delete the given grant resources
 * (the listed grants plus their inheriting children — the dependent closure is
 * computed by the revocation handler) with the data owner's own session.
 * Mirrors `storeGrant`: the worker performs the writes, so the deletes get
 * Temporal activity-retry semantics. Idempotent — 404 is tolerated.
 */
export async function revokeGrants(payload: {
  webId: SocialAgentId
  grants: GrantId[]
}): Promise<void> {
  await deleteDataGrants(payload)
}

/**
 * Signal a running per-grantee consumer to wake up and drain new activities
 * (start-or-signal pattern — the handler signals on AlreadyStarted).
 */
export const granteeActivitiesSignal = defineSignal<[]>('granteeActivitiesSignal')

/** How long an idle consumer waits for a signal before exiting. */
const GRANTEE_IDLE_TIMEOUT = '3 seconds'

/**
 * Per-target consumer (Phase 4.1): started by the webhook handler with a
 * deterministic workflowId per (webId, authorizationGrantee). Drains the
 * pending authorizationRecorded/authorizationRevoked activities for that
 * grantee, coalescing bursts into a single regeneration (full regeneration is
 * idempotent), and marks them done. After an empty drain it waits for a signal
 * (new activity) before exiting, so an activity arriving while the consumer
 * is running is never lost (start-or-signal; residual exit-window gaps are the
 * reconciliation sweep's backstop, §6.11 / Phase 4.2).
 */
export async function processGranteeActivities(
  payload: activities.CreateGrantsInput
): Promise<void> {
  let idle = false
  setHandler(granteeActivitiesSignal, () => {
    idle = false
  })
  while (true) {
    const pending = await getPendingGranteeActivities({
      webId: payload.webId,
      authorizationGrantee: payload.authorizationGrantee,
    })
    if (pending.length === 0) {
      // wait for a signal (a new activity was routed to this consumer) or exit idle
      idle = true
      const signaled = await condition(() => !idle, GRANTEE_IDLE_TIMEOUT)
      if (!signaled) break
      continue
    }
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
    await markActivitiesDone({ webId: payload.webId, activities: pending })
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
  if (payload.activityId) {
    await markActivitiesDone({
      webId: payload.webId,
      activities: [{ id: payload.activityId }],
    })
  }
}

/**
 * Requester hop (grantor-side, §5 System 1): POST the AccessRevocation to the
 * data owner's delegation endpoint, then on success clear the grantor's
 * registration projection (`hasDataGrant`) for the revoked grants, then mark
 * the triggering activity done. The data owner's handler removes the listed
 * grants plus their inheriting children; the response echo drives the link
 * cleanup here.
 */
export async function processGrantsRevocation(
  payload: activities.ProcessGrantsRevocationInput
): Promise<void> {
  await requestGrantRevocation({
    webId: payload.webId,
    dataOwner: payload.dataOwner,
    grants: payload.grants,
  })
  await removeDataGrantsFromRegistration({
    webId: payload.webId,
    grantee: payload.grantee,
    grants: payload.grants,
  })
  if (payload.activityId) {
    await markActivitiesDone({
      webId: payload.webId,
      activities: [{ id: payload.activityId }],
    })
  }
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
  if (payload.activityId) {
    await markActivitiesDone({
      webId: payload.webId,
      activities: [{ id: payload.activityId }],
    })
  }
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
  if (payload.activityId) {
    await markActivitiesDone({
      webId: payload.webId,
      activities: [{ id: payload.activityId }],
    })
  }
}

/**
 * Reconciliation sweep (Phase 4.2): reprocess every pending activity — a
 * non-completion with no `activityCompleted` referencing it — in the webId's
 * Activity Registry; the correctness backstop for missed deliveries, handler
 * crashes and consumer failures (§6.11). Reuses the same routing as the
 * webhook handler: grantee activities join the per-grantee consumer
 * (deterministic workflowId — a running consumer absorbs them), role
 * activities run their workflow and are marked done (one completion activity
 * per entry; duplicate completions are accepted — completion is a container
 * `Add`, so reprocessing an already-done activity is harmless). Idempotent by
 * construction (full regeneration). `agentRegistrationAdded` is skipped
 * (accountId is not resolvable here).
 */
export async function reconcileActivities(payload: {
  webId: SocialAgentId
}): Promise<void> {
  const pending = await getPendingActivities({ webId: payload.webId })
  const granteeGroups = new Map<string, ActivityData[]>()
  const roleActivities: ActivityData[] = []
  for (const activity of pending) {
    if (
      isActivityClass(activity, 'AuthorizationRecorded') ||
      isActivityClass(activity, 'AuthorizationRevoked')
    ) {
      // parties ride the object — the grantee is resolved from the object's
      // DataAuthorization (kind via the store)
      const grantee = await resolveActivityGrantee({ activity })
      if (!grantee) continue
      const group = granteeGroups.get(grantee.id) ?? []
      group.push(activity)
      granteeGroups.set(grantee.id, group)
    } else if (
      isActivityClass(activity, 'RoleMembershipChanged') ||
      isActivityClass(activity, 'RoleDeleted')
    ) {
      roleActivities.push(activity)
    } else if (isActivityClass(activity, 'DelegatedGrantsUpdated')) {
      await executeChild(updateDelegatedGrants, {
        args: [
          {
            webId: payload.webId,
            peerId: { id: activity.target, type: [SOCIAL_AGENT_TYPE] },
            activityId: activity.id,
          },
        ],
      })
      await markActivitiesDone({ webId: payload.webId, activities: [activity] })
    } else if (isActivityClass(activity, 'GrantsRevoked')) {
      const grantsRevoked = activity as GrantsRevoked
      await executeChild(processGrantsRevocation, {
        args: [
          {
            webId: payload.webId,
            grantee: { id: grantsRevoked.grantee, type: [SOCIAL_AGENT_TYPE] },
            dataOwner: grantsRevoked.dataOwner,
            grants: grantsRevoked.object.map((id) => ({ id, type: [DATA_GRANT_TYPE] })),
            activityId: activity.id,
          },
        ],
      })
      await markActivitiesDone({ webId: payload.webId, activities: [activity] })
    } else if (
      isActivityClass(activity, 'AdminAuthorizationRecorded') ||
      isActivityClass(activity, 'AdminAuthorizationRevoked')
    ) {
      // admin activities — same routing as the webhook handler (grants + ACR
      // rewrite, then complete the activity once BOTH succeeded; the children
      // no longer mark done themselves — see processAdminChange)
      const admin = await resolveActivityGrantee({ activity })
      if (!admin) continue
      const args: [AdminWorkflowInput] = [{ webId: payload.webId, admin, activityId: activity.id }]
      await executeChild(
        isActivityClass(activity, 'AdminAuthorizationRecorded')
          ? createAdminGrants
          : revokeAdminGrants,
        { args }
      )
      await executeChild(syncAdminAcr, { args: [{ webId: payload.webId }] })
      await markActivitiesDone({ webId: payload.webId, activities: [activity] })
    } else if (isActivityClass(activity, 'InvitationCreated')) {
      // step 1 — same routing as the webhook handler: the workflow PUTs the
      // invitation at the pre-minted id (find-first — a reconcile re-run
      // after a handler crash sees the existing invitation and only marks
      // the activity done)
      const decoded = activity as InvitationCreated
      await executeChild(createInvitation, {
        args: [
          payload.webId.id,
          {
            id: decoded.object,
            type: [SOCIAL_AGENT_INVITATION_TYPE],
            label: decoded.label,
            note: decoded.note,
          },
          { id: activity.id, type: decoded.type },
        ],
      })
      await markActivitiesDone({ webId: payload.webId, activities: [activity] })
    }
  }
  for (const [granteeId, group] of granteeGroups) {
    const authorizationGrantee = await resolveActivityGrantee({ activity: group[0] })
    if (!authorizationGrantee) continue
    try {
      await executeChild(processGranteeActivities, {
        workflowId: `grantee:${payload.webId.id}:${granteeId}`,
        args: [{ webId: payload.webId, authorizationGrantee }],
      })
    } catch (err) {
      if (!(err instanceof WorkflowExecutionAlreadyStartedError)) throw err
      // a consumer is already draining for this grantee — it picks up the activities
    }
  }
  for (const activity of roleActivities) {
    const roleActivity = activity as RoleMembershipChanged | RoleDeleted
    const args: [activities.ProcessRoleMembershipChangeInput] = [
      {
        webId: payload.webId,
        roleId: { id: roleActivity.target, type: [ROLE_TYPE] },
        peers: roleActivity.object.map((id) => ({ id, type: [SOCIAL_AGENT_TYPE] })),
        activityId: activity.id,
      },
    ]
    if (isActivityClass(activity, 'RoleMembershipChanged')) {
      await executeChild(processRoleMembershipChange, { args })
    } else {
      await executeChild(processRoleDeletion, { args })
    }
    await markActivitiesDone({ webId: payload.webId, activities: [activity] })
  }
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
