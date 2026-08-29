import type { AuthorizationAgent } from '@janeirodigital/interop-authorization-agent'
import {
  AgentRegistry,
  type ApplicationRegistrationData,
  type SocialAgentInvitationData,
  type SocialAgentRegistrationData,
  getAdminGrantIris,
  getDataGrantIris,
  loadClientIdDocument,
  loadWebIdProfile,
} from '@janeirodigital/interop-data-model'
import {
  Application,
  IRI,
  SocialAgent,
  SocialAgentInvitation,
  UnregisteredApplication,
} from '@janeirodigital/sai-api-messages'
import type * as S from 'effect/Schema'
import { invitationUrl } from '../util/uriTemplates.js'
import type { ResolvedContext } from './Context.js'
import {
  findSocialAgentRegistration as findRegistrationFromSparql,
  getApplicationRegistration as getApplicationRegistrationFromSparql,
  getDataGrant as getDataGrantFromSparql,
  getSocialAgentInvitation as getInvitationFromSparql,
  getSocialAgentRegistration as getRegistrationFromSparql,
  listApplicationRegistrations,
  listContained,
  listSocialAgentInvitations,
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
 * The social-agent registrations of the *context* registry, via SPARQL:
 * personal context reads the session's internal endpoint, org context the
 * org's `/sparql-admin` (`sparqlTransportFor`). Seeded registration
 * resources carry own `.acr`s that never grant the admin
 * (registered-agent/org only, org-context-sparql.md §3.0/3b), so HTTP reads
 * 403 for them — SPARQL sidesteps dereferencing entirely.
 */
async function listSocialAgentRegistrations(
  ctx: ResolvedContext
): Promise<SocialAgentRegistrationData[]> {
  const transport = sparqlTransportFor(ctx)
  const iris = await listContained(transport, ctx.registrySet.hasAgentRegistry.id)
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
    ctx.registrySet.hasAgentRegistry.id,
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
    admin = (await getAdminGrantIris(reciprocal)).length > 0
  } else if (!personal) {
    admin = (await getAdminGrantIris(registration)).length > 0
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
    accessGrant: (await getDataGrantIris(registration))[0],
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
    if ((await getDataGrantIris(reciprocalReg)).length === 0) continue
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
    ctx.registrySet.hasAgentRegistry,
    { fetch: ctx.session.fetch, randomUUID: ctx.session.randomUUID },
    { agent: ctx.webId, client: ctx.session.agentId },
    data.webId,
    data.label,
    data.note
  )

  return buildSocialAgentProfile(registration, ctx)
}

const buildApplicationProfile = async (
  ctx: ResolvedContext,
  registration: ApplicationRegistrationData
) => {
  // Design B: the registration resource is single-node — name/logo/accessNeedGroup/
  // callbackEndpoint come from the client ID document (the canonical source)
  const clientIdDocument = await loadClientIdDocument(
    registration.registeredAgent,
    ctx.session.fetch
  )
  // TODO (angel) data validation and how to handle when the applications profile is missing some components?
  return Application.make({
    id: IRI.make(registration.registeredAgent),
    name: clientIdDocument.clientName!,
    logo: clientIdDocument.logoUri,
    //authorizationDate: registration.registeredAt!.toISOString(),
    //lastUpdateDate: registration.updatedAt?.toISOString(),
    accessNeedGroup: clientIdDocument.hasAccessNeedGroup!,
    callbackEndpoint: clientIdDocument.callbackEndpoint,
  })
}
/**
 * Returns all the registered applications for the context registry — via
 * SPARQL over the `interop:hasApplicationRegistration` listing
 * (docs/sparql.md step 3): personal context reads the session's internal
 * endpoint, org context the org's `/sparql-admin` (`sparqlTransportFor`).
 * The per-app profile still dereferences the client-id document over HTTP
 * (webid/client-id profiles stay data-plane).
 */
export const getApplications = async (ctx: ResolvedContext) => {
  const transport = sparqlTransportFor(ctx)
  const iris = await listApplicationRegistrations(transport, ctx.registrySet.hasAgentRegistry.id)
  const registrations = await Promise.all(
    iris.map((iri) => getApplicationRegistrationFromSparql(transport, iri))
  )
  const profiles = []
  for (const registration of registrations) {
    profiles.push(await buildApplicationProfile(ctx, registration))
  }
  return profiles
}

/**
 * Returns the application profile of an application that is _not_ registered for the given agent
 */
export const getUnregisteredApplication = async (agent: AuthorizationAgent, id: IRI) => {
  const { name, logo, accessNeedGroup } = await loadClientIdDocument(id, agent.fetch).then(
    (doc) => ({
      name: doc.clientName,
      logo: doc.logoUri,
      accessNeedGroup: doc.hasAccessNeedGroup,
    })
  )

  return UnregisteredApplication.make({ id: IRI.make(id), name, logo, accessNeedGroup })
}

function buildSocialAgentInvitation(socialAgentInvitation: SocialAgentInvitationData) {
  return SocialAgentInvitation.make({
    id: IRI.make(socialAgentInvitation.id),
    capabilityUrl: socialAgentInvitation.capabilityUrl,
    label: socialAgentInvitation.prefLabel,
    note: socialAgentInvitation.note,
  })
}

/**
 * The context's social-agent invitations via SPARQL over the
 * `hasSocialAgentInvitation` listing (docs/sparql.md, invitations
 * candidate) — personal context reads the session's internal endpoint, org
 * context the org's `/sparql-admin` (`sparqlTransportFor`).
 */
export async function getSocialAgentInvitations(ctx: ResolvedContext) {
  const transport = sparqlTransportFor(ctx)
  const invitations = []
  for (const iri of await listSocialAgentInvitations(
    transport,
    ctx.registrySet.hasAgentRegistry.id
  )) {
    const invitation = await getInvitationFromSparql(transport, iri)
    if (!invitation.registeredAgent) {
      invitations.push(buildSocialAgentInvitation(invitation))
    }
  }
  return invitations
}

export async function createInvitation(
  ctx: ResolvedContext,
  base: { label: string; note?: string }
): Promise<S.Schema.Type<typeof SocialAgentInvitation>> {
  const id = invitationUrl(ctx.webId)
  const socialAgentInvitation = await AgentRegistry.addSocialAgentInvitation(
    ctx.registrySet.hasAgentRegistry,
    { fetch: ctx.session.fetch, randomUUID: ctx.session.randomUUID },
    id,
    base.label,
    base.note
  )
  return buildSocialAgentInvitation(socialAgentInvitation)
}

export async function acceptInvitation(
  ctx: ResolvedContext,
  invitation: { capabilityUrl: string; label: string; note?: string }
): Promise<S.Schema.Type<typeof SocialAgent>> {
  // discover who issued the invitation
  const response = await ctx.session.fetch(invitation.capabilityUrl, {
    method: 'POST',
  })
  if (!response.ok) throw new Error('fetching capability url failed')
  const webId = (await response.text()).trim()
  // TODO: validate with regex
  if (!webId) throw new Error('can not accept invitation without webid')
  // check if agent already has registration
  let socialAgentRegistration = await findSocialAgentRegistrationInContext(ctx, webId)
  if (!socialAgentRegistration) {
    // create new social agent registration
    socialAgentRegistration = await AgentRegistry.addSocialAgentRegistration(
      ctx.registrySet.hasAgentRegistry,
      { fetch: ctx.session.fetch, randomUUID: ctx.session.randomUUID },
      { agent: ctx.webId, client: ctx.session.agentId },
      webId,
      invitation.label,
      invitation.note
    )
  }
  // discover and add reciprocal
  if (!socialAgentRegistration.reciprocalRegistration) {
    ctx.session.discoverAndUpdateReciprocal(socialAgentRegistration)
  }

  // currently api-handler creates job for reciprocal registration

  return buildSocialAgentProfile(socialAgentRegistration, ctx)
}
