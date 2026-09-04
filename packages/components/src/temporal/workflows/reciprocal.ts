import { proxyActivities } from '@temporalio/workflow'
import type {
  AgentRegistrationAddedId,
  EmbeddedSocialAgentInvitation,
  InvitationAcceptedId,
  SocialAgentRegistrationData,
} from '@janeirodigital/interop-data-model'
import type * as activities from '../activities/reciprocal.js'
import type * as grantsActivities from '../activities/grants.js'

const {
  invitationAcceptance,
  reciprocalRegistration,
  reciprocalWebhook,
} = proxyActivities<typeof activities>({
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

/**
 * The inviter-side tail of an invitation accept (template: multi-param +
 * the triggering activity ref): materializes the registration at the
 * pre-minted id from the activity object (find-first), subscribes the
 * reciprocal webhook and completes. The completion rides the
 * `AgentRegistrationAddedId` ref — traceable without dereferencing.
 */
export async function establishReciprocal(
  webId: string,
  registration: SocialAgentRegistrationData,
  accountId: string,
  activity: AgentRegistrationAddedId
): Promise<void> {
  const result = await reciprocalRegistration(webId, registration, accountId)
  await reciprocalWebhook(result)
  // TODO(org-context-sparql phase 4b): create the initial mirror here once
  // SPARQL endpoints are per-owner — until then mirror graphs share their
  // names with the LIVE peer graphs in the single shared store and writing
  // them would destroy the peer's actual resources (federation.md 1a):
  // await syncMirrorActivity({
  //   webId: { id: webId, type: [SOCIAL_AGENT_TYPE] },
  //   peerId: { id: registration.registeredAgent, type: [SOCIAL_AGENT_TYPE] },
  // })
  await markActivitiesDone({
    webId: { id: webId, type: [SOCIAL_AGENT_TYPE] },
    activities: [activity],
  })
}

/**
 * The acceptor-side half of an invitation accept — runs as the acceptor's own
 * AA (personal or org). Mirrors `establishReciprocal` on the acceptor side:
 * POST the opaque capabilityUrl (the inviter's AA creates its registration of
 * us and returns the inviter's webId), build our registration of the inviter,
 * discover the reciprocal, and only then mark the activity done. The decoded
 * activity object (the urn:uuid snapshot) passes verbatim; the completion
 * rides the `InvitationAcceptedId` ref. No webhook subscription —
 * `reciprocalWebhook` remains the inviter side's job.
 */
export async function acceptInvitation(
  webId: string,
  object: EmbeddedSocialAgentInvitation,
  accountId: string,
  activity: InvitationAcceptedId
): Promise<void> {
  const { registration } = await invitationAcceptance(webId, object)
  await reciprocalRegistration(webId, registration, accountId)
  await markActivitiesDone({
    webId: { id: webId, type: [SOCIAL_AGENT_TYPE] },
    activities: [activity],
  })
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