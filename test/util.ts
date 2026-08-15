import {
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
