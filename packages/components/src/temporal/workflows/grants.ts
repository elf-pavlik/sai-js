import { proxyActivities, startChild } from '@temporalio/workflow'
import type * as activities from '../activities/grants.js'

const { findAffectedAuthorizations, updateGrants } = proxyActivities<typeof activities>({
  startToCloseTimeout: '1 minute',
})

export async function updateDelegatedGrants(
  payload: activities.FindAffectedAuthorizationsInput
): Promise<void> {
  const result = await findAffectedAuthorizations(payload)
  // TODO let resource owner's UAS issue the grants
  await Promise.all(
    result.map((payload) =>
      startChild(updateGrantsForAuthorization, {
        args: [payload],
        parentClosePolicy: 'ABANDON',
      })
    )
  )
}

export async function updateGrantsForAuthorization(
  payload: activities.UpdateGrantsInput
): Promise<void> {
  await updateGrants(payload)
}
