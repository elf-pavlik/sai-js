import type { ActivityData } from '@janeirodigital/interop-data-model'
import { proxyActivities } from '@temporalio/workflow'
import type * as activities from '../activities/reciprocal.js'
import type * as grantsActivities from '../activities/grants.js'

const { reciprocalRegistration, reciprocalWebhook } = proxyActivities<typeof activities>({
  startToCloseTimeout: '1 minute',
  // explicit retry: the peer creates its reciprocal registration only after
  // responding to the invitation — replaces the old startDelay hack (§6.7)
  retry: {
    initialInterval: '5s',
    backoffCoefficient: 2,
    maximumInterval: '60s',
    maximumAttempts: 10,
  },
})

// mirror maintenance gets its own policy: the sync re-fetches the peer's
// reciprocal doc + linked grant docs (N round-trips) and rewrites the local
// mirror graphs, so it needs a longer startToClose budget than the
// registration probes. Fewer retries than reciprocalRegistration — a failed
// sync is eventually recovered by the reconcile-sweep mirror arm (plan
// phase 4.2). deleteReciprocalMirror is registered for the future unregister
// flow (dormant).
const { syncReciprocalMirror: syncMirrorActivity, deleteReciprocalMirror: deleteMirrorActivity } =
  proxyActivities<typeof activities>({
    startToCloseTimeout: '5 minutes',
    retry: {
      initialInterval: '5s',
      backoffCoefficient: 2,
      maximumInterval: '60s',
      maximumAttempts: 5,
    },
  })

const { markActivitiesDone } = proxyActivities<typeof grantsActivities>({
  startToCloseTimeout: '1 minute',
})

// NOTE: workflow code runs inside the Temporal sandbox — no runtime imports
// beyond @temporalio/workflow (utils' INTEROP would pull in disallowed Node
// built-ins). The value must match what producers put in `webId.type`.
const SOCIAL_AGENT_TYPE = 'http://www.w3.org/ns/solid/interop#SocialAgent'

export async function establishReciprocal(
  payload: activities.ReciprocalRegistrationInput
): Promise<void> {
  const result = await reciprocalRegistration(payload)
  await reciprocalWebhook(result)
  // TODO(org-context-sparql phase 4b): create the initial mirror here once
  // SPARQL endpoints are per-owner — until then mirror graphs share their
  // names with the LIVE peer graphs in the single shared store and writing
  // them would destroy the peer's actual resources (federation.md 1a):
  // await syncMirrorActivity({
  //   webId: { id: payload.webId, type: [SOCIAL_AGENT_TYPE] },
  //   peerId: { id: payload.peerId, type: [SOCIAL_AGENT_TYPE] },
  // })
  if (payload.activityIri) {
    await markActivitiesDone({
      webId: { id: payload.webId, type: [SOCIAL_AGENT_TYPE] },
      activities: [{ id: payload.activityIri }] as ActivityData[],
    })
  }
}

/**
 * Mirror-sync workflow — started by ActivityWebhookHandler in parallel with
 * updateDelegatedGrants whenever a `delegatedGrantsUpdated` activity arrives:
 * re-fetches the peer's reciprocal registration (+ data grants) with the
 * org's credentials and rewrites the local mirror graphs.
 */
export async function syncReciprocalMirror(
  payload: activities.SyncReciprocalMirrorInput
): Promise<void> {
  await syncMirrorActivity(payload)
}