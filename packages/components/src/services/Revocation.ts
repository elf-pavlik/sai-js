import type { AuthorizationAgent } from '@janeirodigital/interop-authorization-agent'
import type { IRI } from '@janeirodigital/sai-api-messages'
import { GrantRevocationHandler } from '../GrantRevocationHandler.js'
import { removeGrantsFromRegistration } from '../util/registrations.js'

/**
 * Revoke grants at the data owner's boundary, from the owner's own UI.
 *
 * Hits the same handler code path as the delegation endpoint
 * (`GrantRevocationHandler.revokeGrants` — per-grant authority: the requester
 * may revoke grants it issued (`grantedBy`) or any grant in its own registry
 * as the data owner). After the closure is deleted with the owner's session,
 * the requester's own registration projection (`hasDataGrant`) is cleared for
 * the grants it issued — delegated grants (grantedBy ≠ requester) have no
 * registration link in this registry; the grantor's projection is fixed by its
 * own requester hop / reconciliation sweep.
 *
 * Response echoes the request's grant IRIs (all-or-nothing; already-removed
 * entries are echoed too — idempotent no-op).
 */
export const revokeGrants = async (
  saiSession: AuthorizationAgent,
  sparqlEndpoint: string,
  grants: readonly IRI[]
): Promise<readonly IRI[]> => {
  const handler = new GrantRevocationHandler(sparqlEndpoint)
  const revoked = await handler.revokeGrants(grants.map(String), saiSession.webId)

  // clear the requester's registration projection for the removed grants it
  // itself issued (source grants), grouped by grantee
  const byGrantee = new Map<string, string[]>()
  for (const grant of revoked) {
    if (grant.grantedBy !== saiSession.webId) continue
    const list = byGrantee.get(grant.grantee) ?? []
    list.push(grant.iri)
    byGrantee.set(grant.grantee, list)
  }
  for (const [grantee, iris] of byGrantee) {
    await removeGrantsFromRegistration(saiSession, grantee, iris)
  }

  return grants
}
