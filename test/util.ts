import { buildSessionManager } from '@elfpavlik/sai-components'
import {
  type AuthorizationAgent,
  getDataGrant,
  localSparqlTransport,
} from '@janeirodigital/interop-authorization-agent'
import {
  type ActivityData,
  ActivityRegistry,
  type GrantData,
  type SocialAgentRegistrationData,
} from '@janeirodigital/interop-data-model'
import {
  AS,
  RDF,
  getNotificationChannel,
  getOneMatchingQuad,
  parseTurtle,
} from '@janeirodigital/interop-utils'

// TODO: deduplicate with notifications-manager from application package

export interface NotificationStream {
  reader: ReadableStreamDefaultReader<Uint8Array>
  response: Response
}

/**
 * Data grants of a registration, read via the session's SPARQL plane —
 * the SPARQL counterpart of the removed data-model HTTP `getDataGrants`.
 */
export async function dataGrants(
  registration: SocialAgentRegistrationData,
  session: AuthorizationAgent
): Promise<GrantData[]> {
  const transport = localSparqlTransport(session.sparqlEndpoint)
  return Promise.all((registration.hasDataGrant ?? []).map((iri) => getDataGrant(transport, iri)))
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

// ---------------------------------------------------------------------------
// Workflow quiescence — no pending activities for the given webIds
// ---------------------------------------------------------------------------

/**
 * The webId's un-completed activities: registry entries without a matching
 * `activityCompleted` (same read as the worker's `getPendingActivities`).
 * A pending activity means a webhook-triggered workflow is still mid-flight;
 * workflows mark their activity done only on completion (`markActivitiesDone`).
 */
async function pendingActivitiesFor(session: AuthorizationAgent): Promise<ActivityData[]> {
  const registry = session.registrySet.hasActivityRegistry
  if (!registry) return []
  const iris = await ActivityRegistry.getActivityIris(registry, session.fetch)
  const completed = new Set<string>()
  const workItems: ActivityData[] = []
  for (const iri of iris) {
    const activity = await ActivityRegistry.loadActivity(iri, session.fetch)
    if (activity.activityType === 'activityCompleted') {
      completed.add(activity.target)
    } else {
      workItems.push(activity)
    }
  }
  return workItems.filter((activity) => !completed.has(activity.id))
}

/**
 * Wait until none of `webIds` has pending activities for `settle` consecutive
 * polls — i.e. no workflows from earlier tests are still running/mid-flight
 * when the next test starts (webhook-triggered workflows, per-test timeline).
 * Long-lived grantee-consumers stay alive between drains but carry no pending
 * activities, so they don't block settlement.
 */
export async function waitForQuiescence(
  webIds: string[],
  {
    timeout = 30_000,
    interval = 250,
    settle = 2,
  }: { timeout?: number; interval?: number; settle?: number } = {}
): Promise<void> {
  const manager = buildSessionManager()
  // sessions are reused across polls — each getSession performs an OIDC login
  const sessions = await Promise.all(
    webIds.map(async (webId) => [webId, await manager.getSession(webId)] as const)
  )
  const deadline = Date.now() + timeout
  let settled = 0
  while (Date.now() < deadline) {
    const pending = await Promise.all(
      sessions.map(async ([, session]) => (await pendingActivitiesFor(session)).length)
    )
    const total = pending.reduce((sum, count) => sum + count, 0)
    if (total === 0) {
      settled += 1
      if (settled >= settle) return
    } else {
      settled = 0
    }
    await new Promise((resolve) => setTimeout(resolve, interval))
  }
  throw new Error(`workflows did not settle within ${timeout}ms for: ${webIds.join(', ')}`)
}

/**
 * Barrier for a grant-affecting change (wait-for-completion): open the
 * notification stream on `registrationId`, run `trigger`, await the
 * registration `Update`, then — critically — wait until the triggered
 * workflow chain FULLY completed (`waitForQuiescence` over `webIds`). The
 * `Update` arrives MID-CHAIN (from the registration PATCH in a child
 * workflow), while the parent workflow's `activityCompleted` write — its
 * tail — is still pending; proceeding right then races the test's next
 * activity write against that tail in the same activity container (CSS
 * SPARQL-backend concurrent-write corruption, docs/plans).
 */
export async function awaitGrantCompletion(
  authFetch: typeof fetch,
  registrationId: string,
  webIds: string[],
  trigger: () => Promise<unknown>
): Promise<void> {
  const stream = await openNotificationStream(authFetch, registrationId)
  await trigger()
  // CSS delivers the activity Add to the pre-seeded webhook channel (Phase 2) —
  // the workflow runs and the registration Update arrives on this stream
  const received = await awaitNotification(stream, AS.Update)
  if (!received) throw new Error(`expected registration Update on ${registrationId}`)
  await waitForQuiescence(webIds)
}

// ---------------------------------------------------------------------------
// UI events stream (/.sai/events) — the NDJSON stream from refactor-ui.md
// ---------------------------------------------------------------------------

const EVENTS_ENDPOINT = 'https://auth/.sai/events'

export interface EventsStream {
  response: Response
}

/**
 * Open the UI events stream with an account cookie (listen-first: call this
 * BEFORE triggering the RPC/webhook that produces the activity you want to
 * observe). The server never replays — only events after the connection is
 * open are delivered.
 */
export async function openEventsStream(cookie: string): Promise<EventsStream> {
  const response = await fetch(EVENTS_ENDPOINT, {
    headers: { Cookie: cookie },
  })
  if (!response.ok) {
    throw new Error(`failed connecting to events stream: ${EVENTS_ENDPOINT}, ${response.status}`)
  }
  if (!response.body) {
    throw new Error('missing body of events stream')
  }
  return { response }
}

/**
 * Read NDJSON lines until one matches the predicate. Returns the matching
 * message, or undefined if the stream ends. Closes the stream unless
 * `close: false` (staged reads — pending then done on the same connection).
 *
 * Each call acquires its own reader: between staged reads the previous
 * reader is released, so a fresh one must be requested (reads continue from
 * the same buffered position).
 */
export async function awaitEvent(
  stream: EventsStream,
  predicate: (message: { type: string; activity?: any }) => boolean,
  options: { close?: boolean } = { close: true }
): Promise<{ type: string; activity?: any } | undefined> {
  const { response } = stream
  // the body is unlocked between staged reads — acquire a fresh reader here
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) return undefined
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        if (!line) continue
        const message = JSON.parse(line) as { type: string; activity?: any }
        if (predicate(message)) return message
      }
    }
  } finally {
    reader.releaseLock()
    // keep the stream open between staged reads (pending → done on the same
    // connection); the caller closes it on the final read
    if (options.close) await response.body.cancel()
  }
  return undefined
}
