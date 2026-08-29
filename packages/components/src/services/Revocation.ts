import type { IRI } from '@janeirodigital/sai-api-messages'
import { GrantRevocationHandler } from '../GrantRevocationHandler.js'
import type { ResolvedContext } from './Context.js'

/**
 * Revoke grants at the data owner's boundary, from the owner's own UI.
 *
 * Hits the same handler code path as the delegation endpoint
 * (`GrantRevocationHandler.revokeGrants` — per-grant authority: the requester
 * may revoke grants it issued (`grantedBy`) or any grant in its own registry
 * as the data owner). The owner identity is the **context** (`ctx.webId`),
 * not the session's. After the closure is deleted with the session, the
 * requester's own registration projection (`hasDataGrant`) is cleared for
 * the grants it issued — delegated grants (grantedBy ≠ owner) have no
 * registration link in this registry; the grantor's projection is fixed by
 * its own requester hop / reconciliation sweep.
 *
 * Response echoes the request's grant IRIs (all-or-nothing; already-removed
 * entries are echoed too — idempotent no-op).
 */
export const revokeGrants = async (
  ctx: ResolvedContext,
  sparqlEndpoint: string,
  grants: readonly IRI[]
): Promise<readonly IRI[]> => {
  // the owner is the context — the session manager shim answers with it
  const handler = new GrantRevocationHandler(sparqlEndpoint, {
    getSession: async () => ctx.session,
  })
  const revoked = await handler.revokeGrants(grants.map(String), ctx.webId)

  // clear the requester's registration projection for the removed grants it
  // itself issued (source grants), grouped by grantee
  const byGrantee = new Map<string, string[]>()
  for (const grant of revoked) {
    if (grant.grantedBy !== ctx.webId) continue
    const list = byGrantee.get(grant.grantee) ?? []
    list.push(grant.iri)
    byGrantee.set(grant.grantee, list)
  }
  for (const [grantee, iris] of byGrantee) {
    await ctx.session.removeGrantsFromRegistration(grantee, iris)
  }

  return grants
}
