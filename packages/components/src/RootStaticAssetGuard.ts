import { HttpHandler, NotImplementedHttpError, parseForwarded } from '@solid/community-server'
import type { HttpHandlerInput } from '@solid/community-server'
import { getLoggerFor } from 'global-logger-factory'

/**
 * Wraps CSS's `StaticAssetHandler` and refuses to serve the **root** static
 * asset on a pod subdomain.
 *
 * The data server combines the `static-root` init (no root container to
 * persist) with the **subdomain** identifier strategy: the base host
 * (`data.docker`) serves the static landing page, while every pod root is the
 * *path* `/` on a subdomain (`alice-home.data.docker/`). CSS's
 * `StaticAssetHandler` matches on the path only, so without this guard it
 * shadows every pod root container with the landing page — a bug that only
 * shows up on subdomain servers, never on path-based ones (where pod roots are
 * `/pod/`, not `/`).
 *
 * Only the exact root path is blocked; every other static asset (styles,
 * favicon, `.well-known` files) still falls through to the wrapped handler on
 * all hosts. A blocked request raises `NotImplementedHttpError` so the
 * surrounding `StatusWaterfallHandler` continues to the LDP handler, which
 * resolves the pod and serves its actual container. Requests without a
 * resolvable subdomain host (e.g. an internal `Host` header) keep the previous
 * behaviour.
 */
export class RootStaticAssetGuard extends HttpHandler {
  protected readonly logger = getLoggerFor(this)
  private readonly baseHost: string

  public constructor(
    private readonly handler: HttpHandler,
    baseUrl: string
  ) {
    super()
    this.baseHost = normalizeHost(new URL(baseUrl).hostname)
  }

  public async canHandle(input: HttpHandlerInput): Promise<void> {
    if (this.isPodRootRequest(input)) {
      this.logger.debug('Not serving the static root asset on a pod subdomain')
      throw new NotImplementedHttpError('The static root asset is only served on the base host')
    }
    return this.handler.canHandle(input)
  }

  public async handle(input: HttpHandlerInput): Promise<void> {
    return this.handler.handle(input)
  }

  /**
   * True when the request targets `/` on a subdomain of the server's base host
   * (`alice-home.data.docker` for base host `data.docker`). Uses the same host
   * resolution as CSS's `OriginalUrlExtractor` (`Forwarded` / `X-Forwarded-Host`
   * first) so a reverse proxy in front of the server does not hide the pod host.
   */
  private isPodRootRequest({ request }: HttpHandlerInput): boolean {
    const [path] = (request.url ?? '').split('?')
    if (path !== '/') {
      return false
    }
    const { host } = parseForwarded(request.headers)
    const requestHost = normalizeHost((host ?? request.headers.host ?? '').split(':')[0])
    return (
      requestHost.length > 0 &&
      requestHost !== this.baseHost &&
      requestHost.endsWith(`.${this.baseHost}`)
    )
  }
}

/** Hosts are case-insensitive and may carry a trailing root dot. */
function normalizeHost(host: string): string {
  return host.toLowerCase().replace(/\.$/u, '')
}
