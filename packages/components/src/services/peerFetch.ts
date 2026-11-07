import type { AuthorizationAgent } from '@janeirodigital/interop-authorization-agent'
import { fetchJsonLd } from '@janeirodigital/interop-utils'

/**
 * Raised by `fetchPeerResource` when the target IRI is not an absolute
 * http(s) IRI, or when the peer does not serve a JSON-LD document. Listed in
 * `.componentsignore` — not instantiable as a Components.js component.
 */
export class PeerFetchError extends Error {}

/**
 * The org-side upstream fetch behind `/.sai/proxy-admin`: fetch a peer
 * resource — a data registration document or a data instance document —
 * with the ORG's session credentials, the grantee, whose data grants the
 * peer's permission engine authorizes (org-context-proxy.md). Runs on the
 * **org's server** inside `ProxyAdminHandler`, responding to the admin's
 * AA's proxy request; the admin side never holds the org session and
 * reaches this over HTTP as the admin instead (plan:
 * `services/peerProxy.ts`).
 *
 * The document is read through `fetchJsonLd`, which prefers the LWS JSON-LD
 * profile and — when an LWS-only peer answers a **container** with the LWS
 * JSON page listing (no own RDF, no frameable containment) — re-fetches it as
 * RDF. The proxy therefore serves a JSON-LD document for both documents and
 * containers, no matter which LWS/Solid shape the peer speaks. The return
 * value is that expanded JSON-LD document; non-ok upstream responses throw
 * `HttpStatusError` (carrying the status, which `ProxyAdminHandler` maps).
 *
 * Only absolute http(s) targets are accepted — the org's credentials must
 * never be pointed at other schemes.
 */
export async function fetchPeerResource(
  orgSession: AuthorizationAgent,
  targetId: string
): Promise<unknown> {
  let target: URL
  try {
    target = new URL(targetId)
  } catch {
    throw new PeerFetchError(`target must be an absolute http(s) IRI: ${targetId}`)
  }
  if (target.protocol !== 'http:' && target.protocol !== 'https:') {
    throw new PeerFetchError(`target must be an absolute http(s) IRI: ${targetId}`)
  }
  try {
    return await fetchJsonLd(target.href, orgSession.fetch)
  } catch (error) {
    // upstream status/network failures keep their identity so the handler can
    // surface them; only an unparseable body becomes a client-facing error
    if (error instanceof Error && error.name === 'HttpStatusError') throw error
    throw new PeerFetchError(
      `peer resource is not a JSON-LD document: ${target.href} (${(error as Error).message})`
    )
  }
}
