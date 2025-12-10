import { proxyActivities } from '@temporalio/workflow'
import type * as activities from '../activities/reciprocal.js'

const { reciprocalRegistration, reciprocalWebhook } = proxyActivities<typeof activities>({
  startToCloseTimeout: '1 minute',
})

export async function establishReciprocal(
  payload: activities.ReciprocalRegistrationInput
): Promise<void> {
  const result = await reciprocalRegistration(payload)
  await reciprocalWebhook(result)
}
