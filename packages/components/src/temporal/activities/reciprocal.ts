import type { SocialAgentId } from '@janeirodigital/interop-data-model'
import { loadSocialAgentRegistration } from '@janeirodigital/interop-data-model'
import { AgentRegistry } from '@janeirodigital/interop-authorization-agent'
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
  activityId?: string
}

export interface ReciprocalWebhookInput {
  accountId: string
  webId: string
  peerId: string
  topic: string
}

export interface AcceptInvitationInput {
  accountId: string
  webId: string
  capabilityUrl: string
  label: string
  note?: string
  /** IRI of the activity that triggered this workflow — marked done on success */
  activityId?: string
}

export interface AcceptInvitationOutput {
  inviterWebId: string
  registrationId: string
}

/**
 * The acceptor side of the common accept protocol (org-context-improvements
 * plan): POSTs the **opaque** capabilityUrl as the acceptor — its own AA
 * session, personal or org — so the inviter's AA creates *its* registration of
 * the acceptor and returns the inviter's webId (the only place the inviter's
 * identity is learned). Then creates the acceptor's registration of the
 * inviter (find-first — idempotent under workflow retries). The reciprocal
 * discovery is left to the workflow's `reciprocalRegistration` activity.
 */
export async function invitationAcceptance(
  payload: AcceptInvitationInput
): Promise<AcceptInvitationOutput> {
  const manager = buildSessionManager()
  const session = await manager.getSession(payload.webId)
  const response = await session.fetch(payload.capabilityUrl, { method: 'POST' })
  if (!response.ok) throw new Error(`accepting capability url failed: ${response.status}`)
  const inviterWebId = (await response.text()).trim()
  if (!inviterWebId) throw new Error('can not accept invitation without webid')

  let registration = await session.findSocialAgentRegistration(inviterWebId)
  if (!registration) {
    registration = await AgentRegistry.addSocialAgentRegistration(
      session.registrySet.hasSocialAgentRegistry,
      { fetch: session.fetch, randomUUID: session.randomUUID },
      { agent: payload.webId, client: session.agentId },
      inviterWebId,
      payload.label,
      payload.note
    )
  }
  return { inviterWebId, registrationId: registration.id }
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
    await session.discoverAndUpdateReciprocal(registration)
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
