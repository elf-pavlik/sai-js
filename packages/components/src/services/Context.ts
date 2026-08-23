import { type AuthorizationAgent } from '@janeirodigital/interop-authorization-agent'
import { getAdminGrantIris } from '@janeirodigital/interop-data-model'
import type { SessionManager } from '../SessionManager'

/** The requested context is not allowed for the signed-in user. */
export class ContextError extends Error {}

/**
 * The resolved context a service operation runs in (§2.4 of
 * org-admin-feature.md). The admin context is gated on the admin marker, then
 * operates **as the org's own AuthorizationAgent** (its UAS authenticates —
 * the same identity the org's workflows and peer-facing reads use, so
 * reciprocal/peer registries that grant the org read access are reachable,
 * and writes carry the org's owner rights). The admin only *authenticates* to
 * select and authorize the context; the org is the data owner.
 */
export type ResolvedContext = {
  /** the session to operate with (user's own in the personal context) */
  session: AuthorizationAgent
  /** the context webId — the owner identity for writes; equals session.webId */
  webId: string
  /** the signed-in user's webId */
  userWebId: string
}

/**
 * True when the signed-in user is an admin of `orgWebId`. The admin marker
 * lives on the org's registration of the user — the reciprocal of the user's
 * own registration of the org — as a non-empty `hasAdminGrant` link (§2.2
 * asymmetry of org-admin-feature.md).
 */
async function isAdminOf(userSession: AuthorizationAgent, orgWebId: string): Promise<boolean> {
  const registration = await userSession.findSocialAgentRegistration(orgWebId)
  if (!registration?.reciprocalRegistration) return false
  const reciprocal = await userSession.factory.socialAgentRegistration(
    registration.reciprocalRegistration
  )
  return (await getAdminGrantIris(reciprocal)).length > 0
}

/**
 * Resolve a request's `context` webId into the session to operate with.
 *
 * - the personal context (the user's own webId) is always allowed and resolves
 *   to the user's own session;
 * - an organization context is allowed only when the user is an admin of that
 *   org; the org's registry set is resolved through the org's agent-id
 *   document (`Link: rel="interop:hasRegistrySet"`, served only to admins —
 *   §2.3) and the org's own session is built on it (the org's UAS performs
 *   the actual operations — peer reads and owner writes alike).
 */
export async function resolveContext(
  userSession: AuthorizationAgent,
  context: string,
  sessionManager: SessionManager
): Promise<ResolvedContext> {
  if (context === userSession.webId) {
    return { session: userSession, webId: userSession.webId, userWebId: userSession.webId }
  }
  if (!(await isAdminOf(userSession, context))) {
    throw new ContextError(`not an admin of ${context}`)
  }
  const registrySet = await userSession.getRegistrySet(context)
  const session = await sessionManager.getSession(context, registrySet.id)
  return { session, webId: context, userWebId: userSession.webId }
}