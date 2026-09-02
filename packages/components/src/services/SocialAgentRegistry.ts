import type { AuthorizationAgent } from '@janeirodigital/interop-authorization-agent'
import { ActivityRegistry, AgentRegistry } from '@janeirodigital/interop-authorization-agent'
import {
  type SocialAgentRegistrationData,
  getAdminGrantIris,
  getDataGrantIris,
  loadWebIdProfile,
} from '@janeirodigital/interop-data-model'
import { IRI, InvitationAccepted, SocialAgent } from '@janeirodigital/sai-api-messages'
import type * as S from 'effect/Schema'
import type { ResolvedContext } from './Context.js'
import {
  findSocialAgentRegistration as findRegistrationFromSparql,
  getDataGrant as getDataGrantFromSparql,
  getSocialAgentRegistration as getRegistrationFromSparql,
  listContained,
  sparqlTransportFor,
} from './queries/org.js'

/**
 * Resolve the reciprocal registration of `registration` (the peer's
 * registration of us / of the org) via SPARQL — personal context hits the
 * session's internal endpoint, org context the org's `/sparql-admin`
 * (`sparqlTransportFor`). The peer's graphs live in the shared store
 * (federation.md shortcut 1); their `.acr`s grant the org/registered agent,
 * never the admin.
 */
async function getReciprocalRegistration(
  ctx: ResolvedContext,
  registration: SocialAgentRegistrationData
): Promise<SocialAgentRegistrationData> {
  if (!registration.reciprocalRegistration) {
    throw new Error(`no reciprocal registration on ${registration.id}`)
  }
  return getRegistrationFromSparql(sparqlTransportFor(ctx), registration.reciprocalRegistration)
}

/**
 * The social-agent registrations of the *context* social-agent registry, via
 * SPARQL over its server-managed `ldp:contains` listing: personal context
 * reads the session's internal endpoint, org context the org's
 * `/sparql-admin` (`sparqlTransportFor`). Seeded registration resources
 * carry own `.acr`s that never grant the admin (registered-agent/org only,
 * org-context-sparql.md §3.0/3b), so HTTP reads 403 for them — SPARQL
 * sidesteps dereferencing entirely.
 */
async function listSocialAgentRegistrations(
  ctx: ResolvedContext
): Promise<SocialAgentRegistrationData[]> {
  const transport = sparqlTransportFor(ctx)
  const iris = await listContained(transport, ctx.registrySet.hasSocialAgentRegistry.id)
  return Promise.all(iris.map((iri) => getRegistrationFromSparql(transport, iri)))
}

export { listSocialAgentRegistrations }

/**
 * Find the context registry's registration of `webId` (match on
 * `registeredAgent`) via SPARQL — personal context hits the session's
 * internal endpoint, org context the org's `/sparql-admin` (see
 * `listSocialAgentRegistrations`).
 */
export const findSocialAgentRegistrationInContext = async (
  ctx: ResolvedContext,
  webId: string
): Promise<SocialAgentRegistrationData | undefined> => {
  return findRegistrationFromSparql(
    sparqlTransportFor(ctx),
    ctx.registrySet.hasSocialAgentRegistry.id,
    webId
  )
}

/**
 * Build the UI profile of a social agent from its registration.
 *
 * `personal` selects which side carries the admin marker (§2.2 asymmetry of
 * org-admin-feature.md):
 * - `true` (personal context) — `registration` is OUR registration of the
 *   agent; the admin marker lives on the AGENT'S registration of us (reached
 *   via `reciprocalRegistration`, non-empty `hasAdminGrant`);
 * - `false` (org context) — `registration` is the ORG's registration of the
 *   agent; the admin marker is read directly from it.
 */
export const buildSocialAgentProfile = async (
  registration: SocialAgentRegistrationData,
  ctx: ResolvedContext,
  personal = true
) => {
  const reciprocal = registration.reciprocalRegistration
    ? await getReciprocalRegistration(ctx, registration)
    : undefined
  let admin = false
  if (personal && reciprocal) {
    admin = getAdminGrantIris(reciprocal).length > 0
  } else if (!personal) {
    admin = getAdminGrantIris(registration).length > 0
  }

  // TODO (angel) data validation and how to handle when the social agents profile is missing some components?
  return SocialAgent.make({
    id: IRI.make(registration.registeredAgent),
    label: registration.prefLabel,
    note: registration.note,
    //authorizationDate: registration.registeredAt!.toISOString(),
    //lastUpdateDate: registration.updatedAt?.toISOString(),
    accessRequested: !!registration.hasAccessNeedGroup,
    admin,
    // the grantor-side registration's hasDataGrant: the grants WE issued to
    // this agent — first grant IRI; absent → the SocialAgentList warning badge
    accessGrant: getDataGrantIris(registration)[0],
    accessNeedGroup: reciprocal?.hasAccessNeedGroup,
  })
}

export const getSocialAgents = async (ctx: ResolvedContext) => {
  const personal = ctx.webId === ctx.userWebId
  const transport = sparqlTransportFor(ctx)
  const registrations = await listSocialAgentRegistrations(ctx)

  const profiles = []
  for (const registration of registrations) {
    profiles.push(await buildSocialAgentProfile(registration, ctx, personal))
  }

  const seenIds = new Set(profiles.map((p) => p.id))
  for (const registration of registrations) {
    if (!registration.reciprocalRegistration) continue
    const reciprocalReg = await getRegistrationFromSparql(
      transport,
      registration.reciprocalRegistration
    )
    if (getDataGrantIris(reciprocalReg).length === 0) continue
    const dataGrants = await Promise.all(
      reciprocalReg.hasDataGrant.map((grantIri) => getDataGrantFromSparql(transport, grantIri))
    )
    for (const dataGrant of dataGrants) {
      const ownerIri = IRI.make(dataGrant.dataOwner)
      if (seenIds.has(ownerIri)) continue
      seenIds.add(ownerIri)
      let label = dataGrant.dataOwner
      try {
        const profile = await loadWebIdProfile(ownerIri, ctx.session.fetch)
        if (profile.label) label = profile.label
      } catch {
        /* fallback to IRI */
      }
      profiles.push(
        SocialAgent.make({
          id: ownerIri,
          label,
          accessRequested: false,
          // no registration in this registry — no admin marker can be read
          admin: false,
        })
      )
    }
  }

  return profiles
}

export const addSocialAgent = async (
  ctx: ResolvedContext,
  data: { webId: string; label: string; note?: string }
) => {
  const existing = await findSocialAgentRegistrationInContext(ctx, data.webId)
  if (existing) {
    // logger.error('SocialAgentRegistration already exists', { webId: data.webId })
    return buildSocialAgentProfile(existing, ctx)
  }
  const registration = await AgentRegistry.addSocialAgentRegistration(
    ctx.registrySet.hasSocialAgentRegistry,
    { fetch: ctx.session.fetch, randomUUID: ctx.session.randomUUID },
    { agent: ctx.webId, client: ctx.session.agentId },
    data.webId,
    data.label,
    data.note
  )

  return buildSocialAgentProfile(registration, ctx)
}

/**
 * Record the acceptance and let the acceptor's own workflow perform the
 * cross-AA legs — the capabilityUrl is opaque here (org-context-improvements
 * plan: “activity-first, both contexts”). The `invitationAccepted` activity
 * lands in the acceptor's Activity Registry (own for personal, the org's for
 * admin context); `ActivityWebhookHandler` dispatches the acceptor's
 * `acceptInvitation` workflow, which POSTs the opaque capabilityUrl as the
 * acceptor and builds the acceptor → inviter registration.
 */
export async function acceptInvitation(
  ctx: ResolvedContext,
  invitation: { capabilityUrl: string; label: string; note?: string }
): Promise<S.Schema.Type<typeof InvitationAccepted>> {
  const activityRegistry = ctx.registrySet.hasActivityRegistry
  if (!activityRegistry) throw new Error('activity registry not found in registry set')
  await ActivityRegistry.createActivity(
    activityRegistry,
    { fetch: ctx.session.fetch, randomUUID: ctx.session.randomUUID },
    {
      activityType: 'invitationAccepted',
      target: ctx.registrySet.id,
      payload: {
        webId: ctx.webId,
        capabilityUrl: invitation.capabilityUrl,
        label: invitation.label,
        note: invitation.note,
      },
      createdAt: new Date().toISOString(),
    }
  )
  return InvitationAccepted.make({ accepted: true })
}