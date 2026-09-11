import type {
  AgentId,
  ActivityData,
  AdminAuthorizationRecorded,
  AdminAuthorizationRevoked,
  AuthorizationGranted,
  AuthorizationGrantedId,
  DelegatedGrantsUpdated,
  FinalDataAuthorizationData,
  FinalGrantData,
  GrantId,
  InvitationCreated,
  NeedBasedAccessRequestReceived,
  NeedBasedAccessRequestSent,
  RoleData,
  RoleCreated,
  RoleCreatedId,
  RoleDeleted,
  RoleDeletedId,
  RoleMembershipChanged,
  RoleMembershipChangedId,
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
import {
  processAdminAuthorizationRecorded,
  processAdminAuthorizationRevoked,
} from './admin.js'
import type { AdminWorkflowInput } from './admin.js'
import { createInvitation } from './invitation.js'
import {
  processNeedBasedAccessRequest,
  processNeedBasedAccessRequestReceived,
} from './access-request.js'

// NOTE: workflow code runs inside the Temporal sandbox — no runtime imports
// beyond @temporalio/workflow (utils' INTEROP would pull in disallowed Node
// built-ins). The values must match what producers put in the refs they build.
const ROLE_TYPE = 'http://www.w3.org/ns/solid/interop#Role'
const SOCIAL_AGENT_TYPE = 'http://www.w3.org/ns/solid/interop#SocialAgent'
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
  createRoleAtId,
  storeDataGrant,
  createAcr,
  requestDelegation,
  replaceDataGrantsOnRegistration,
  getPendingGranteeActivities,
  getPendingActivities,
  resolveActivityGrantee,
  resolveAuthorizationGrantee,
  storeAuthorizationGranted,
  updateRoleInRegistry,
  deleteRoleFromRegistry,
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

/**
 * The dedicated granting workflow (architecture.md §4) — activity-first step
 * 2 (authorization-granting.md): materialize the embedded DataAuthorizations
 * at the pre-minted ids (find-first), then regenerate the grantee's grants
 * (registry-state full regeneration — identical end-state to today), then
 * single completion via the activity ref. The live-link / deny-snapshot object
 * forms (transient) have nothing to materialize — regeneration alone (to
 * empty, for the snapshot) preserves the current behavior until Step 3/4.
 */
export async function processAuthorizationGranted(
  webId: SocialAgentId,
  dataAuthorizations: AuthorizationGranted['object'],
  activity: AuthorizationGrantedId
): Promise<void> {
  if (
    Array.isArray(dataAuthorizations) &&
    dataAuthorizations.length > 0 &&
    typeof dataAuthorizations[0] === 'object'
  ) {
    await storeAuthorizationGranted({
      webId,
      dataAuthorizations: dataAuthorizations as FinalDataAuthorizationData[],
    })
  }
  const authorizationGrantee = await resolveAuthorizationGrantee({
    webId,
    object: dataAuthorizations,
  })
  if (!authorizationGrantee) return
  // role → members expansion + per-member regeneration — the same step the
  // per-grantee consumer ran (createGrantsForAgent only handles agents)
  await createGrantsForAuthorization({ webId, authorizationGrantee })
  await markActivitiesDone({ webId, activities: [activity] })
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
export async function createRole(
  webId: SocialAgentId,
  role: RoleData,
  activity: RoleCreatedId
): Promise<void> {
  // activity-first step 9: the RPC wrote only the activity (object = the
  // role-to-be at the PRE-MINTED id) — this workflow PUTs the role there
  // (find-first idempotent), then completes. No derived work: no
  // authorizations can exist before the role exists (the PUT is the create).
  await createRoleAtId({ webId, role })
  await markActivitiesDone({ webId, activities: [activity] })
}

export async function processRoleMembershipChange(
  webId: SocialAgentId,
  role: RoleData,
  activity: RoleMembershipChangedId
): Promise<void> {
  // activity-first step 2: the RPC wrote only the intended change (the
  // role-to-be as the activity's real-id embedded object) — this workflow
  // PATCHes the role to that state, derives the affected diff from the
  // before-image the activity loaded, regenerates and completes. Idempotent:
  // a re-run sees the role already equal to the intended state → empty diff.
  const beforeMembers = new Set(await updateRoleInRegistry({ webId, role }))
  const afterMembers = new Set(role.members)
  const changed = [
    ...[...beforeMembers].filter((member) => !afterMembers.has(member)),
    ...[...afterMembers].filter((member) => !beforeMembers.has(member)),
  ]
  const usage = await findRoleUsage({ webId, roleId: { id: role.id, type: role.type } })
  const affected: AgentId[] = []
  const seen = new Set<string>()
  const add = (agent: AgentId) => {
    if (seen.has(agent.id)) return
    seen.add(agent.id)
    affected.push(agent)
  }
  // role used as grantee → the changed members' received grants changed
  if (usage.usedAsGrantee) {
    for (const member of changed) add({ id: member, type: [SOCIAL_AGENT_TYPE] })
  }
  // role used as dataOwner → the *grantees of those authorizations* are affected
  for (const grantee of usage.affectedGrantees) {
    if (grantee.type.includes(ROLE_TYPE)) {
      const members = await getGrantees({ webId, grantee })
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
            webId,
            grantee,
          },
        ],
      })
    )
  )
  // single completion after all branches succeed (children never mark done)
  await markActivitiesDone({ webId, activities: [activity] })
}

export async function processRoleDeletion(
  webId: SocialAgentId,
  role: RoleData,
  activity: RoleDeletedId
): Promise<void> {
  // scan BEFORE the deletions — the usage info and the matched authorization
  // ids must be captured while the authorizations still exist; the affected
  // members ride the object (the write-time snapshot — unrecoverable from
  // the store after the role and its role-grantee authorizations are gone,
  // e.g. on a retry after a crash between the DELETE and the completion)
  const usage = await findRoleUsage({ webId, roleId: { id: role.id, type: role.type } })
  await deleteAuthorizations({ webId, authorizations: usage.authorizations })
  // the role must be gone before the regeneration: the self-contained
  // createGrantsForAgent re-derives memberships from the store (find-first,
  // 404-tolerant — a retry sees the role already deleted and skips)
  await deleteRoleFromRegistry({ webId, role })
  const affected: AgentId[] = []
  const seen = new Set<string>()
  const add = (agent: AgentId) => {
    if (seen.has(agent.id)) return
    seen.add(agent.id)
    affected.push(agent)
  }
  // role.members ARE the grantees of grantee-authorizations — read from the
  // embedded object, not the store (the role is gone by now)
  if (usage.usedAsGrantee) {
    for (const member of role.members) add({ id: member, type: [SOCIAL_AGENT_TYPE] })
  }
  // grantees of dataOwner-authorizations — route by type
  for (const grantee of usage.affectedGrantees) {
    if (grantee.type.includes(ROLE_TYPE)) {
      const members = await getGrantees({ webId, grantee })
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
            webId,
            grantee,
          },
        ],
      })
    )
  )
  // single completion after all branches succeed (children never mark done)
  await markActivitiesDone({ webId, activities: [activity] })
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
    if (isActivityClass(activity, 'AuthorizationGranted')) {
      // dedicated workflow (step 2 — architecture.md §4): materialize the
      // embedded DataAuthorizations at the pre-minted ids, regenerate grants;
      // self-completes (the outer markActivitiesDone is the accepted
      // duplicate for a reconcile re-run)
      const granted = activity as AuthorizationGranted
      await executeChild(processAuthorizationGranted, {
        args: [payload.webId, granted.object, { id: activity.id, type: [...granted.type] }],
      })
      await markActivitiesDone({ webId: payload.webId, activities: [activity] })
    } else if (isActivityClass(activity, 'AuthorizationRevoked')) {
      // no producer today (revocation plan) — keep the per-grantee consumer
      // grouping; the grantee is resolved from the object (kind via the store)
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
      const decoded = activity as DelegatedGrantsUpdated
      await executeChild(updateDelegatedGrants, {
        args: [
          {
            webId: payload.webId,
            peerId: { id: decoded.target, type: [SOCIAL_AGENT_TYPE] },
            activityId: activity.id,
          },
        ],
      })
      await markActivitiesDone({ webId: payload.webId, activities: [activity] })
    } else if (isActivityClass(activity, 'NeedBasedAccessRequestReceived')) {
      // the owner-side leg (authorization-granting.md §6.2) — same routing as
      // the webhook handler: the workflow PUTs the immutable AccessRequest at
      // the minted id (find-first — a reconcile re-run sees the resource and
      // only marks done), then completes
      const received = activity as NeedBasedAccessRequestReceived
      await executeChild(processNeedBasedAccessRequestReceived, {
        args: [payload.webId, received.object, { id: activity.id, type: [...received.type] }],
      })
      await markActivitiesDone({ webId: payload.webId, activities: [activity] })
    } else if (isActivityClass(activity, 'NeedBasedAccessRequestSent')) {
      // the requester-side access-request leg (authorization-granting.md
      // §6.4) — same routing as the webhook handler: the workflow forwards
      // the request to the data owner's (reused) issuance endpoint (expects
      // 202), then completes (self-completing; the outer markActivitiesDone
      // is the accepted duplicate for a reconcile re-run)
      const sent = activity as NeedBasedAccessRequestSent
      await executeChild(processNeedBasedAccessRequest, {
        args: [payload.webId, sent.object, { id: activity.id, type: [...sent.type] }],
      })
      await markActivitiesDone({ webId: payload.webId, activities: [activity] })
    } else if (isActivityClass(activity, 'RoleCreated')) {
      // step 9 — the workflow PUTs the role at the pre-minted id, then
      // completes (self-completing; the outer markActivitiesDone is the
      // accepted duplicate)
      const created = activity as RoleCreated
      await executeChild(createRole, {
        args: [payload.webId, created.object, { id: activity.id, type: [...created.type] }],
      })
      await markActivitiesDone({ webId: payload.webId, activities: [activity] })
    } else if (isActivityClass(activity, 'AdminAuthorizationRecorded')) {
      // step 5 — the workflow PUTs the AdminAuthorization at the pre-minted
      // id, materializes grants + the ACR rewrite, then completes
      // (self-completing; the outer markActivitiesDone is the accepted
      // duplicate for a reconcile re-run)
      const recorded = activity as AdminAuthorizationRecorded
      await executeChild(processAdminAuthorizationRecorded, {
        args: [payload.webId, recorded.object, { id: activity.id, type: [...recorded.type] }],
      })
      await markActivitiesDone({ webId: payload.webId, activities: [activity] })
    } else if (isActivityClass(activity, 'AdminAuthorizationRevoked')) {
      // step 6 — the workflow DELETEs the AdminAuthorization at the embedded
      // id, revokes grants + the ACR rewrite, then completes (self-completing;
      // the outer markActivitiesDone is the accepted duplicate)
      const revoked = activity as AdminAuthorizationRevoked
      await executeChild(processAdminAuthorizationRevoked, {
        args: [payload.webId, revoked.object, { id: activity.id, type: [...revoked.type] }],
      })
      await markActivitiesDone({ webId: payload.webId, activities: [activity] })
    } else if (isActivityClass(activity, 'InvitationCreated')) {
      // step 1 — same routing as the webhook handler: the workflow PUTs the
      // invitation at the pre-minted id (find-first — a reconcile re-run
      // after a handler crash sees the existing invitation and only marks
      // the activity done)
      const decoded = activity as InvitationCreated
      await executeChild(createInvitation, {
        args: [payload.webId.id, decoded.object, { id: activity.id, type: decoded.type }],
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
    // steps 2–3: both role classes carry the role-to-be as a real-id
    // embedded object (`target` dropped) — same multi-param signature
    if (isActivityClass(activity, 'RoleMembershipChanged')) {
      const roleActivity = activity as RoleMembershipChanged
      await executeChild(processRoleMembershipChange, {
        args: [
          payload.webId,
          roleActivity.object,
          { id: activity.id, type: [...roleActivity.type] },
        ],
      })
    } else {
      const roleActivity = activity as RoleDeleted
      await executeChild(processRoleDeletion, {
        args: [
          payload.webId,
          roleActivity.object,
          { id: activity.id, type: [...roleActivity.type] },
        ],
      })
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
