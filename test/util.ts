import {
  RDF,
  getNotificationChannel,
  getOneMatchingQuad,
  parseTurtle,
} from '@janeirodigital/interop-utils'
import { ActivityRegistry, type AuthorizationAgentFactory } from '@janeirodigital/interop-data-model'

// TODO: deduplicate with notifications-manager from application package

// Pre-seeded activity-webhook channels for the main agents (environments/data/kv.json).
// The sendTo URL is where the ActivityWebhookHandler receives the notification.
export const ACTIVITY_WEBHOOK_SEND_TO: Record<string, string> = {
  'https://id/alice':
    'https://auth/.sai/activity-webhook/b1ceb966-e444-4cc3-be54-bf5bfec8750a',
  'https://id/bob': 'https://auth/.sai/activity-webhook/b82fc383-a56f-4736-8724-17c9cec6eea3',
  'https://id/kim': 'https://auth/.sai/activity-webhook/ccad737e-f100-4f78-841b-46fb4daf7310',
}

export interface ActivityProducerSession {
  webId: string
  factory: AuthorizationAgentFactory
  registrySet: { hasActivityRegistry?: { id: string } }
}

// Activities already simulated as delivered (per test run — the seed is
// re-applied in beforeEach, so old IRIs never reappear).
const deliveredActivities = new Set<string>()

/**
 * Simulate CSS delivering the container `Add` notification(s) for every
 * activity the producer service(s) PUT since the last call (ldp:contains
 * order is not guaranteed, so delivered IRIs are tracked). POSTs each
 * notification to the pre-seeded webhook channel of `session.webId`.
 */
export async function deliverActivityNotification(session: ActivityProducerSession): Promise<void> {
  const registry = session.registrySet.hasActivityRegistry
  if (!registry) throw new Error(`no activity registry for ${session.webId}`)
  const sendTo = ACTIVITY_WEBHOOK_SEND_TO[session.webId]
  if (!sendTo) throw new Error(`no pre-seeded activity webhook for ${session.webId}`)
  const iris = await ActivityRegistry.getActivityIris(registry, session.factory)
  // beforeEach re-seeds the quadstore — an empty registry means a fresh seed,
  // so previously tracked IRIs are gone forever (reuse of old IRIs impossible)
  if (iris.length === 0) deliveredActivities.clear()
  const undelivered = iris.filter((iri) => !deliveredActivities.has(iri))
  if (undelivered.length === 0) throw new Error('no new activity to deliver')
  for (const activityIri of undelivered) {
    deliveredActivities.add(activityIri)
    const response = await fetch(sendTo, {
      method: 'POST',
      headers: { 'Content-Type': 'application/ld+json' },
      body: JSON.stringify({ type: 'Add', object: activityIri, target: registry.id }),
    })
    if (!response.ok) throw new Error(`failed delivering activity notification: ${response.status}`)
  }
}

export interface NotificationStream {
  reader: ReadableStreamDefaultReader<Uint8Array>
  response: Response
}

/**
 * Open the notification stream for a resource (channel discovered via the
 * HEAD Link header) and discard the initial state notification. Call this
 * BEFORE triggering the change you want to observe so no event is missed
 * while the follow-up workflow runs asynchronously.
 */
export async function openNotificationStream(
  authFetch: typeof fetch,
  resourceId: string
): Promise<NotificationStream> {
  const headResponse = await authFetch(resourceId, { method: 'HEAD' })
  const linkHeader = headResponse.headers.get('link')
  if (!linkHeader) throw new Error('Link header is missing')
  const receiveFrom = getNotificationChannel(linkHeader)
  if (!receiveFrom) throw new Error(`Failed to discover notification chanel for: ${resourceId}`)

  const response = await authFetch(receiveFrom)
  if (!response.ok) {
    throw new Error(`failed connecting to notification stream: ${receiveFrom}, ${response.status}`)
  }
  if (!response.body) {
    throw new Error(`missing body of notification stream: ${receiveFrom}`)
  }
  const reader = response.body.getReader()
  const decoder = new TextDecoder()

  // discard initial notification
  await reader.read()

  return { reader, response }
}

/**
 * Read from an open stream until a notification arrives (optionally of the
 * given type). Returns true on match; false if the stream ends without one.
 * Closes the stream in all cases.
 */
export async function awaitNotification(
  stream: NotificationStream,
  expectedType?: string
): Promise<boolean> {
  const { reader, response } = stream
  const decoder = new TextDecoder()
  try {
    while (response.body.locked) {
      const { done, value } = await reader.read()
      if (done) return false
      const notification = decoder.decode(value)
      if (!notification) continue
      const dataset = await parseTurtle(notification)
      const receivedType = getOneMatchingQuad(dataset, undefined, RDF.terms.type)!.object.value
      if (!expectedType || receivedType === expectedType) return true
    }
  } finally {
    reader.releaseLock()
    await response.body.cancel()
  }
  return false
}

/** Open the stream, await the first notification of the expected type (listen-first pattern). */
export async function receivesNotification(
  authFetch: typeof fetch,
  resourceId: string,
  expectedType?: string
): Promise<boolean> {
  const stream = await openNotificationStream(authFetch, resourceId)
  return awaitNotification(stream, expectedType)
}

/**
 * Poll a predicate until it resolves truthy or the timeout elapses.
 * Throws the last predicate error (or a timeout error) on failure.
 */
export async function waitFor<T>(
  predicate: () => Promise<T>,
  { timeout = 10_000, interval = 250 }: { timeout?: number; interval?: number } = {}
): Promise<T> {
  const deadline = Date.now() + timeout
  let lastError: unknown
  while (Date.now() < deadline) {
    try {
      const result = await predicate()
      if (result) return result
    } catch (err) {
      lastError = err
    }
    await new Promise((resolve) => setTimeout(resolve, interval))
  }
  if (lastError) throw lastError
  throw new Error(`waitFor timed out after ${timeout}ms`)
}
