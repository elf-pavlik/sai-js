import type { AuthorizationAgent } from '@janeirodigital/interop-authorization-agent'

/**
 * Raised by `fetchPeerResource` when the target IRI is not an absolute
 * http(s) IRI. Listed in `.componentsignore` — not instantiable as a
 * Components.js component.
 */
export class PeerFetchError extends Error {}

/**
 * JSON-LD-only contract: the proxy serves (and forwards) only
 * `application/ld+json`; binary and any other representation are out of
 * scope. Used by `ProxyAdminHandler` on the upstream content-type.
 */
export function isJsonLdContentType(contentType: string): boolean {
  return contentType.includes('application/ld+json')
}

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
 * JSON-LD only: `Accept: application/ld+json` is pinned — binary and any
 * other representation are out of scope for now.
 *
 * Only absolute http(s) targets are accepted — the org's credentials must
 * never be pointed at other schemes.
 *
 * Callers own the status handling: `ProxyAdminHandler` maps non-ok
 * upstream responses to CSS HTTP errors. Network/upstream failures reject
 * with the underlying error.
 */
export async function fetchPeerResource(
  orgSession: AuthorizationAgent,
  targetIri: string
): Promise<Response> {
  let target: URL
  try {
    target = new URL(targetIri)
  } catch {
    throw new PeerFetchError(`target must be an absolute http(s) IRI: ${targetIri}`)
  }
  if (target.protocol !== 'http:' && target.protocol !== 'https:') {
    throw new PeerFetchError(`target must be an absolute http(s) IRI: ${targetIri}`)
  }
  return orgSession.fetch(target.href, { headers: { Accept: 'application/ld+json' } })
}