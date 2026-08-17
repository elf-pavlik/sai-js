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
  if (payload.activityIri) {
    await markActivitiesDone({
      webId: { id: payload.webId, type: [SOCIAL_AGENT_TYPE] },
      activities: [{ id: payload.activityIri }] as ActivityData[],
    })
  }
}