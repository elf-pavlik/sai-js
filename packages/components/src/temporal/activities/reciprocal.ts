import { type SocialAgentId, discoverAndUpdateReciprocal } from '@janeirodigital/interop-data-model'
import { loadSocialAgentRegistration } from '@janeirodigital/interop-data-model'
import { SubscriptionClient } from '@solid-notifications/subscription'
import { ChannelType } from '@solid-notifications/types'
import { ReciprocalWebhookStore } from '../../ReciprocalWebhookStore.js'
import { buildAccountLoginStorage } from '../../builders/accountLoginStorage.js'
import { buildSessionManager } from '../../builders/sessionManager.js'
import {
  deleteReciprocalMirror as deleteMirror,
  updateReciprocalMirror,
} from '../../services/ReciprocalMirror.js'

function webhookTargetUrl(): string {
  return `${process.env.CSS_BASE_URL}.sai/reciprocal-webhook/${crypto.randomUUID()}`
}

export interface ReciprocalRegistrationInput {
  accountId: string
  webId: string
  peerId: string
  registrationId: string
  /** IRI of the activity that triggered this workflow — marked done on success */
  activityIri?: string
}

export interface ReciprocalWebhookInput {
  accountId: string
  webId: string
  peerId: string
  topic: string
}

export async function reciprocalRegistration(
  payload: ReciprocalRegistrationInput
): Promise<ReciprocalWebhookInput> {
  const manager = buildSessionManager()
  const session = await manager.getSession(payload.webId)
  const registration = await loadSocialAgentRegistration(payload.registrationId, session.fetch)
  if (registration.registeredAgent !== payload.peerId) {
    throw new Error(
      `invalid payload - peerId: ${payload.peerId}, registrationId: ${payload.registrationId}, registeredAgent: ${registration.registeredAgent}`
    )
  }
  if (!registration.reciprocalRegistration) {
    await discoverAndUpdateReciprocal(registration, session.fetch)
  }
  if (!registration.reciprocalRegistration) {
    throw new Error(`reciprocal registration from ${payload.peerId} was not found`)
  }
  // NOTE: the initial reciprocal-mirror write is deliberately NOT here — it
  // is orchestrated by the establishReciprocal workflow (its own activity,
  // own retry policy), currently disabled until phase 4b
  // (org-context-sparql.md / federation.md 1a)
  return {
    accountId: payload.accountId,
    webId: payload.webId,
    peerId: payload.peerId,
    topic: registration.reciprocalRegistration,
  }
}

export interface SyncReciprocalMirrorInput {
  /** the org whose registration of `peerId` carries the reciprocal link */
  webId: SocialAgentId
  /** the peer whose reciprocal registration (+ data grants) gets mirrored */
  peerId: SocialAgentId
}

function sparqlEndpoint(): string {
  const endpoint = process.env.CSS_SPARQL_ENDPOINT
  if (!endpoint) throw new Error('CSS_SPARQL_ENDPOINT env missing!')
  return endpoint
}

/**
 * Refresh the local read-only mirror of the peer's reciprocal registration
 * and its linked data grants (org-context-sparql.md phase 1). Runs with the
 * org's own session credentials — server-side, where they are legitimate.
 */
export async function syncReciprocalMirror(payload: SyncReciprocalMirrorInput): Promise<void> {
  const manager = buildSessionManager()
  const session = await manager.getSession(payload.webId.id)
  const registration = await session.findSocialAgentRegistration(payload.peerId.id)
  if (!registration?.reciprocalRegistration) return
  await updateReciprocalMirror(session, registration, sparqlEndpoint())
}

/**
 * Remove the local mirror of the peer's reciprocal registration + its linked
 * grants (org-context-sparql.md phase 1). Dormant — the unregister flow that
 * calls this does not exist yet; when it lands it should run this as one
 * compensable step of a Temporal workflow (compensation: re-run
 * `updateReciprocalMirror`). Call while the org's registration of the peer
 * still exists — the reciprocal IRI is read from it.
 */
export async function deleteReciprocalMirror(payload: {
  webId: SocialAgentId
  peerId: SocialAgentId
}): Promise<void> {
  const manager = buildSessionManager()
  const session = await manager.getSession(payload.webId.id)
  const registration = await session.findSocialAgentRegistration(payload.peerId.id)
  if (!registration?.reciprocalRegistration) return
  await deleteMirror(registration, sparqlEndpoint())
}

export async function reciprocalWebhook(payload: ReciprocalWebhookInput): Promise<void> {
  const store = new ReciprocalWebhookStore(await buildAccountLoginStorage())
  await store.handle()
  const existing = await store.findAllBetween(payload.webId, payload.peerId)
  if (existing.length) return

  const manager = buildSessionManager()
  const session = await manager.getSession(payload.webId)
  const subscriptionClient = new SubscriptionClient(session.fetch)
  const channel = await subscriptionClient.subscribe(
    payload.topic,
    ChannelType.WebhookChannel2023,
    webhookTargetUrl()
  )
  await store.create(payload.accountId, payload.webId, payload.peerId, channel)
}
