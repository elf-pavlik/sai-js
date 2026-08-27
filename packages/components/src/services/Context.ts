import {
  type AuthorizationAgent,
  getSocialAgentRegistration,
  localSparqlTransport,
} from '@janeirodigital/interop-authorization-agent'
import { type RegistrySetData, getAdminGrantIris } from '@janeirodigital/interop-data-model'

/** The requested context is not allowed for the signed-in user. */
export class ContextError extends Error {}

/**
 * The resolved context a service operation runs in (§2.4 of
 * org-admin-feature.md). `session` is **ALWAYS the signed-in user's own
 * AuthorizationAgent** — no org session is minted (org-context-sparql.md
 * phase 3). The org context is gated on the admin marker, then targets the
 * org's registry set; owner identity for writes is `webId` (the context).
 */
export type ResolvedContext = {
  /** ALWAYS the signed-in user's own AuthorizationAgent */
  session: AuthorizationAgent
  /** target registries: own (personal) or org's (admin context) */
  registrySet: RegistrySetData
  /** owner identity for writes: context webId */
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
  // the reciprocal via the shared SPARQL query (same as the service layer's
  // org-context reads) over the session's internal endpoint
  const reciprocal = await getSocialAgentRegistration(
    localSparqlTransport(userSession.sparqlEndpoint),
    registration.reciprocalRegistration
  )
  return (await getAdminGrantIris(reciprocal)).length > 0
}

/**
 * Resolve a request's `context` webId into the struct services operate on.
 *
 * - the personal context (the user's own webId) is always allowed and
 *   resolves to the user's own registry set;
 * - an organization context is allowed only when the user is an admin of
 *   that org; the org's registry set is resolved through the org's agent-id
 *   document (`Link: rel="interop:hasRegistrySet"`, served only to admins —
 *   §2.3) and **no second session is built**: the user's own AA performs
 *   operations, targeting `ctx.registrySet` and owning writes as
 *   `ctx.webId`. Org-context reads must already be SPARQL-backed (§3.0/
 *   3b) — per-resource `.acr`s never grant the admin over HTTP.
 */
export async function resolveContext(
  userSession: AuthorizationAgent,
  context: string
): Promise<ResolvedContext> {
  if (context === userSession.webId) {
    return {
      session: userSession,
      registrySet: userSession.registrySet,
      webId: userSession.webId,
      userWebId: userSession.webId,
    }
  }
  if (!(await isAdminOf(userSession, context))) {
    throw new ContextError(`not an admin of ${context}`)
  }
  const registrySet = await userSession.getRegistrySet(context)
  return { session: userSession, registrySet, webId: context, userWebId: userSession.webId }
}
