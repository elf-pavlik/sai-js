import type { AgentId, SocialAgentId } from '@janeirodigital/interop-data-model'
import { executeChild, proxyActivities } from '@temporalio/workflow'
import type * as adminActivities from '../activities/admin.js'
import type * as grantsActivities from '../activities/grants.js'

const {
  buildAdminGrants,
  storeAdminGrant,
  createAdminGrantAcr,
  replaceAdminGrantLink,
  findAdminGrants,
  deleteAdminGrants,
  syncAdminAcr: syncAdminAcrActivity,
} = proxyActivities<typeof adminActivities>({
  startToCloseTimeout: '1 minute',
})

const { markActivitiesDone } = proxyActivities<Pick<typeof grantsActivities, 'markActivitiesDone'>>(
  {
    startToCloseTimeout: '1 minute',
  }
)

export interface AdminWorkflowInput {
  webId: SocialAgentId
  /** the admin webId (typed SocialAgent) */
  admin: AgentId
  /** IRI of the activity that triggered this workflow — completed by the orchestrator / grantee consumer once the ACR rewrite also succeeded */
  activityId?: string
}

/** Input of the sequential orchestrator the webhook handler starts (phase 4). */
export interface AdminChangeInput extends AdminWorkflowInput {
  activityType: 'adminAuthorizationRecorded' | 'adminAuthorizationRevoked'
}

/**
 * Add — `adminAuthorizationRecorded`: materialize the admin marker. One
 * RegistrySet-scoped AdminGrant (linked on the registration via
 * `hasAdminGrant` in a single PATCH — one Update) plus one Read-only
 * DataRegistry-scoped grant per data registry in the org's RegistrySet, each
 * with its own ACR. Idempotent against re-delivery: the link replace rewrites
 * rather than duplicates (fresh grants are created on each run, mirroring the
 * data-grant regeneration path).
 *
 * Completion is NOT recorded here — the caller (processAdminChange or the
 * grantee consumer in grants.ts) marks done only after the ACR rewrite also
 * succeeded, so an activity never completes while one of its two pieces
 * failed (the createAdminGrants-masks-syncAdminAcr hazard).
 */
export async function createAdminGrants(payload: AdminWorkflowInput): Promise<void> {
  const { registrySetGrant, dataRegistryGrants } = await buildAdminGrants({
    webId: payload.webId,
    admin: payload.admin,
  })
  // TODO CSS SPARQL backend has a race condition on dcterms:modified when
  // multiple resources are PUT concurrently in the same container — serialized
  for (const grant of [registrySetGrant, ...dataRegistryGrants]) {
    await storeAdminGrant(grant)
    await createAdminGrantAcr({ grant })
  }
  // only the RegistrySet-scoped grant is linked (the admin marker; data
  // registries are reached through the RegistrySet)
  await replaceAdminGrantLink({
    webId: payload.webId,
    admin: payload.admin,
    grantIds: [registrySetGrant.id!],
  })
}

/**
 * Remove — `adminAuthorizationRevoked`: delete the admin's RegistrySet- and
 * DataRegistry-scoped AdminGrants (resources + ACRs) and unlink
 * `hasAdminGrant` from the registration (single PATCH → one Update).
 * Completion is recorded by the caller (see createAdminGrants).
 */
export async function revokeAdminGrants(payload: AdminWorkflowInput): Promise<void> {
  const grants = await findAdminGrants({ webId: payload.webId, admin: payload.admin })
  await deleteAdminGrants({ webId: payload.webId, grants })
  await replaceAdminGrantLink({ webId: payload.webId, admin: payload.admin, grantIds: [] })
}

/**
 * Both — rewrite the org's `.acr` `#fullAdminAccess` matchers from the
 * current admin list (idempotent derived rewrite; the AuthorizationRegistry is
 * the source of truth, last-admin guard inside the activity). Completion is
 * recorded by the caller (see createAdminGrants).
 */
export async function syncAdminAcr(payload: {
  webId: SocialAgentId
  activityId?: string
}): Promise<void> {
  await syncAdminAcrActivity({ webId: payload.webId })
}

/**
 * Sequential orchestrator (phase 4): grants materialization THEN the derived
 * ACR rewrite, and only when both succeeded is the activity marked done. The
 * webhook handler starts only this workflow (previously two parallel
 * workflows each marked done — an activity completed while the ACR rewrite
 * had failed, and successful runs wrote duplicate completions). The grantee
 * consumer in grants.ts mirrors the same order.
 */
export async function processAdminChange(payload: AdminChangeInput): Promise<void> {
  await executeChild(
    payload.activityType === 'adminAuthorizationRecorded' ? createAdminGrants : revokeAdminGrants,
    {
      args: [{ webId: payload.webId, admin: payload.admin }],
    }
  )
  await executeChild(syncAdminAcr, { args: [{ webId: payload.webId }] })
  if (payload.activityId) {
    await markActivitiesDone({
      webId: payload.webId,
      activities: [{ id: payload.activityId }],
    })
  }
}
