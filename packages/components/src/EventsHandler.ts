import { PassThrough } from 'node:stream'
import {
  BasicRepresentation,
  ForbiddenHttpError,
  InternalServerError,
  OkResponseDescription,
  OperationHttpHandler,
  SOLID_HTTP,
  guardStream,
} from '@solid/community-server'
import type {
  CookieStore,
  OperationHttpHandlerInput,
  ResponseDescription,
  WebIdStore,
} from '@solid/community-server'
import { getLoggerFor } from 'global-logger-factory'
import type { ActivityEvents } from './ActivityEvents.js'

/** Heartbeat cadence — the UI's timeout detection uses a multiple of this. */
export const EVENTS_HEARTBEAT_INTERVAL_MS = 30_000

/**
 * Always-open NDJSON event stream for the UI (`GET /.sai/events`). Resolves
 * the account's first linked webId from the account cookie — exactly like
 * `ApiHandler` — registers a `PassThrough` on the `ActivityEvents` bus under
 * that webId, heartbeats every ~30s and unregisters on close/abort. The
 * response streams via a `Guarded<Readable>` body, the same pattern CSS's own
 * `StreamingHttpRequestHandler` uses.
 */
export class EventsHandler extends OperationHttpHandler {
  protected readonly logger = getLoggerFor(this)
  public constructor(
    private readonly cookieStore: CookieStore,
    private readonly webIdStore: WebIdStore,
    private readonly activityEvents: ActivityEvents
  ) {
    super()
  }
  public async handle({
    operation,
    response,
  }: OperationHttpHandlerInput): Promise<ResponseDescription> {
    // Determine account — same as ApiHandler
    const cookie = operation.body.metadata.get(SOLID_HTTP.terms.accountCookie)?.value
    if (!cookie) {
      throw new ForbiddenHttpError()
    }
    const accountId = await this.cookieStore.get(cookie)
    if (!accountId) {
      throw new InternalServerError('no accountId')
    }
    const webIdLinks = await this.webIdStore.findLinks(accountId)
    const webId = webIdLinks[0]?.webId
    if (!webId) {
      throw new ForbiddenHttpError('no linked webId')
    }

    const stream = guardStream(new PassThrough())
    this.activityEvents.subscribe(webId, stream)
    stream.on('close', () => this.activityEvents.unsubscribe(webId, stream))
    stream.on('error', () => this.activityEvents.unsubscribe(webId, stream))

    // Flush the response headers with an initial heartbeat: like CSS's own
    // StreamingHttpRequestHandler (which writes the initial notification),
    // the first write is what makes BasicResponseWriter's writeHead + first
    // chunk reach the client — a stream with nothing written until an event
    // arrives never flushes the headers and the client fetch hangs.
    try {
      stream.write('{"type":"heartbeat"}\n')
    } catch {
      // stream was already destroyed — nothing left to flush
    }

    const heartbeat = setInterval(() => {
      if (stream.destroyed) {
        clearInterval(heartbeat)
        return
      }
      try {
        stream.write('{"type":"heartbeat"}\n')
      } catch {
        clearInterval(heartbeat)
      }
    }, EVENTS_HEARTBEAT_INTERVAL_MS)
    stream.on('close', () => clearInterval(heartbeat))

    // the stream is long-lived and must not be cached
    response.setHeader('Cache-Control', 'no-store')

    const representation = new BasicRepresentation('', operation.target, 'application/x-ndjson')
    return new OkResponseDescription(representation.metadata, stream)
  }
}