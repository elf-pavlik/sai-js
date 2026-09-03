import { proxyActivities } from '@temporalio/workflow'
import type { InvitationCreatedId } from '@janeirodigital/interop-data-model'
import type * as invitationActivities from '../activities/invitation.js'
import type * as grantsActivities from '../activities/grants.js'

const { createSocialAgentInvitation } = proxyActivities<typeof invitationActivities>({
  startToCloseTimeout: '1 minute',
})

const { markActivitiesDone } = proxyActivities<typeof grantsActivities>({
  startToCloseTimeout: '1 minute',
})

// NOTE: workflow code runs inside the Temporal sandbox — no runtime imports
// beyond @temporalio/workflow (utils' INTEROP would pull in disallowed Node
// built-ins). The value must match what producers put in `webId.type`.
const SOCIAL_AGENT_TYPE = 'http://www.w3.org/ns/solid/interop#SocialAgent'

/**
 * The activity-first createInvitation leg (step 1): the RPC only wrote the
 * `invitationCreated` activity (label/note + the pre-minted invitation id);
 * this workflow PUTs the invitation resource at that id with the context's
 * own session, generates the capabilityUrl there, and only then completes
 * the activity. The capabilityUrl is unknowable before this runs — no
 * pre-PUT accept window exists (the accept side can never race it). The
 * triggering activity rides as a typed ref (`InvitationCreatedId`) so the
 * completion it writes is traceable without dereferencing.
 */
export async function createInvitation(
  webId: string,
  invitation: invitationActivities.CreateInvitationPojo,
  activity: InvitationCreatedId
): Promise<void> {
  await createSocialAgentInvitation(webId, invitation)
  await markActivitiesDone({
    webId: { id: webId, type: [SOCIAL_AGENT_TYPE] },
    activities: [activity],
  })
}