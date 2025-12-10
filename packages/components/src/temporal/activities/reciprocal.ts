import { SubscriptionClient } from '@solid-notifications/subscription'
import { ChannelType } from '@solid-notifications/types'
import { ReciprocalWebhookStore } from '../../ReciprocalWebhookStore.js'
import { buildAccountLoginStorage } from '../../builders/accountLoginStorage.js'
import { buildSessionManager } from '../../builders/sessionManager.js'

function webhookTargetUrl(): string {
  return `${process.env.CSS_BASE_URL}.sai/reciprocal-webhook/${crypto.randomUUID()}`
}

export interface ReciprocalRegistrationInput {
  accountId: string
  webId: string
  peerId: string
  registrationId: string
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
  const registration = await session.factory.crud.socialAgentRegistration(payload.registrationId)
  if (registration.registeredAgent !== payload.peerId) {
    throw new Error(
      `invalid payload - peerId: ${payload.peerId}, registrationId: ${payload.registrationId}, registeredAgent: ${registration.registeredAgent}`
    )
  }
  if (!registration.reciprocalRegistration) {
    await registration.discoverAndUpdateReciprocal(session.rawFetch)
  }
  if (!registration.reciprocalRegistration) {
    throw new Error(`reciprocal registration from ${payload.peerId} was not found`)
  }
  return {
    accountId: payload.accountId,
    webId: payload.webId,
    peerId: payload.peerId,
    topic: registration.reciprocalRegistration.iri,
  }
}

export async function reciprocalWebhook(payload: ReciprocalWebhookInput): Promise<void> {
  const store = new ReciprocalWebhookStore(await buildAccountLoginStorage())
  await store.handle()
  const existing = await store.findAllBetween(payload.webId, payload.peerId)
  if (existing.length) return

  const manager = buildSessionManager()
  const session = await manager.getSession(payload.webId)
  const subscriptionClient = new SubscriptionClient(session.rawFetch)
  const channel = await subscriptionClient.subscribe(
    payload.topic,
    ChannelType.WebhookChannel2023,
    webhookTargetUrl()
  )
  await store.create(payload.accountId, payload.webId, payload.peerId, channel)
}
