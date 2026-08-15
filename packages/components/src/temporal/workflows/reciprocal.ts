import { proxyActivities } from '@temporalio/workflow'
import type * as activities from '../activities/reciprocal.js'

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

export async function establishReciprocal(
  payload: activities.ReciprocalRegistrationInput
): Promise<void> {
  const result = await reciprocalRegistration(payload)
  await reciprocalWebhook(result)
}
