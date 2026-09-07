import {
  type EmbeddedNeedBasedAccessRequest,
  type NeedBasedAccessRequestReceivedId,
  type NeedBasedAccessRequestSentId,
  type SocialAgentId,
  dataModelContext,
} from '@janeirodigital/interop-data-model'
import { INTEROP, putJsonLd, withContext } from '@janeirodigital/interop-utils'
import { buildSessionManager } from '../../builders/sessionManager.js'
import { issuanceUrl } from '../../util/uriTemplates.js'

export interface ForwardNeedBasedAccessRequestInput {
  requester: SocialAgentId
  /** the request snapshot (urn:uuid id) as embedded in the activity */
  request: EmbeddedNeedBasedAccessRequest
  /** the triggering `needBasedAccessRequestSent` activity (completion ref) */
  activity: NeedBasedAccessRequestSentId
}

/**
 * The requester-side leg of a need-based access request
 * (authorization-granting.md §6.5): POST the request to the data owner's
 * REUSED grant-issuance endpoint (`issuanceUrl(dataOwner)`) AS the requester
 * (`getSession(requester)` — client = the requester's UAS), expecting **202
 * Accepted (empty body)**. The owner side only VALIDATES in the current
 * phase — the mint + `NeedBasedAccessRequestReceived` activity + the
 * owner-side materialization workflow land in the receive-side phase.
 */
export async function forwardNeedBasedAccessRequest(
  input: ForwardNeedBasedAccessRequestInput
): Promise<void> {
  const manager = buildSessionManager()
  const session = await manager.getSession(input.requester.id)
  const endpoint = issuanceUrl(input.request.dataOwner)
  const response = await session.fetch(endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/ld+json',
    },
    body: JSON.stringify({
      type: [INTEROP.NeedBasedAccessRequest],
      grantee: input.request.grantee,
      grantedBy: input.request.grantedBy,
      dataOwner: input.request.dataOwner,
      hasAccessNeedGroup: input.request.hasAccessNeedGroup,
    }),
  })
  if (response.status !== 202) {
    throw new Error(`expected 202 but received ${response.status} from ${endpoint}`)
  }
}

export interface MaterializeNeedBasedAccessRequestInput {
  dataOwner: SocialAgentId
  /** the request-to-be — real-id embedded projection at the minted id */
  request: EmbeddedNeedBasedAccessRequest
  /** the triggering `needBasedAccessRequestReceived` activity (completion ref) */
  activity: NeedBasedAccessRequestReceivedId
}

/**
 * The owner-side leg of a need-based access request (authorization-granting.md
 * §6.5): PUT the immutable AccessRequest at the minted id
 * (`getSession(dataOwner)`). Find-first idempotent — a workflow retry or the
 * reconcile re-delivery after a crash sees the existing resource and skips
 * the write (the stored request is NEVER mutated).
 */
export async function materializeNeedBasedAccessRequest(
  input: MaterializeNeedBasedAccessRequestInput
): Promise<void> {
  const manager = buildSessionManager()
  const session = await manager.getSession(input.dataOwner.id)
  const existing = await session.fetch(input.request.id, { method: 'HEAD' })
  if (existing.status === 200) return
  const doc = withContext(dataModelContext, input.request)
  await putJsonLd(input.request.id, session.fetch, doc, { 'If-None-Match': '*' })
}
