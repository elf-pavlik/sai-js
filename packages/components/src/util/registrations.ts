import type { AuthorizationAgent } from '@janeirodigital/interop-authorization-agent'
import {
  AgentRegistry,
  getDataGrantIris,
  replaceDataGrants,
} from '@janeirodigital/interop-data-model'

/**
 * Remove the given grant IRIs from a grantee's registration `hasDataGrant`
 * links in the given session's registry — the projection cleanup shared by
 * the requester-hop Temporal activity and the data-owner revocation RPC.
 * Rewrites the links via `replaceDataGrants` (one PATCH, exactly one Update
 * notification), never the delete-only `removeDataGrant` route. No-op when
 * the grantee has no registration (nothing to clear).
 */
export async function removeGrantsFromRegistration(
  session: AuthorizationAgent,
  grantee: string,
  grants: string[]
): Promise<void> {
  const registration = await AgentRegistry.findRegistration(
    session.registrySet.hasAgentRegistry,
    session.factory,
    grantee
  )
  if (!registration) return // nothing to clear — the projection is already empty
  const revoked = new Set(grants)
  const current = await getDataGrantIris(registration)
  const remaining = current.filter((iri) => !revoked.has(iri))
  await replaceDataGrants(registration, session.factory, remaining)
}
