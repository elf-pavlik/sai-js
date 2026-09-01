import { AgentRegistry } from '@janeirodigital/interop-authorization-agent'
import type { SocialAgentInvitationData } from '@janeirodigital/interop-data-model'
import { IRI, SocialAgentInvitation } from '@janeirodigital/sai-api-messages'
import type * as S from 'effect/Schema'
import { invitationUrl } from '../util/uriTemplates.js'
import type { ResolvedContext } from './Context.js'
import {
  getSocialAgentInvitation as getInvitationFromSparql,
  listContained,
  sparqlTransportFor,
} from './queries/org.js'

function buildSocialAgentInvitation(socialAgentInvitation: SocialAgentInvitationData) {
  return SocialAgentInvitation.make({
    id: IRI.make(socialAgentInvitation.id),
    capabilityUrl: socialAgentInvitation.capabilityUrl,
    label: socialAgentInvitation.prefLabel,
    note: socialAgentInvitation.note,
  })
}

/**
 * The context's social-agent invitations via SPARQL over the invitation
 * registry's server-managed `ldp:contains` listing (docs/sparql.md,
 * invitations candidate) — personal context reads the session's internal
 * endpoint, org context the org's `/sparql-admin` (`sparqlTransportFor`).
 */
export async function getSocialAgentInvitations(ctx: ResolvedContext) {
  const transport = sparqlTransportFor(ctx)
  const invitations = []
  for (const iri of await listContained(transport, ctx.registrySet.hasInvitationRegistry.id)) {
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
    ctx.registrySet.hasInvitationRegistry,
    { fetch: ctx.session.fetch, randomUUID: ctx.session.randomUUID },
    id,
    base.label,
    base.note
  )
  return buildSocialAgentInvitation(socialAgentInvitation)
}