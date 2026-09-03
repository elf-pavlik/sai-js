import { ActivityRegistry } from '@janeirodigital/interop-authorization-agent'
import type { InvitationCreated, SocialAgentInvitationData } from '@janeirodigital/interop-data-model'
import { IRI, InvitationCreatedMessage, SocialAgentInvitation } from '@janeirodigital/sai-api-messages'
import { iriForContained } from '@janeirodigital/interop-utils'
import type * as S from 'effect/Schema'
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
    label: socialAgentInvitation.label,
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

/**
 * Activity-first (step 1 of activity-first-services.md): the RPC only mints
 * the invitation id (`iriForContained`) and writes the `invitationCreated`
 * activity — the `createInvitation` workflow PUTs the invitation resource at
 * the minted id and generates the capabilityUrl there (unknowable before the
 * workflow runs, so the pending ack echoes only label/note + the minted id).
 */
export async function createInvitation(
  ctx: ResolvedContext,
  base: { label: string; note?: string }
): Promise<S.Schema.Type<typeof InvitationCreatedMessage>> {
  const invitationRegistry = ctx.registrySet.hasInvitationRegistry
  const activityRegistry = ctx.registrySet.hasActivityRegistry
  if (!activityRegistry) throw new Error('activity registry not found in registry set')
  const invitationId = iriForContained(invitationRegistry, ctx.session.randomUUID)
  const activity: Omit<InvitationCreated, 'id'> = {
    type: ['Activity', 'InvitationCreated', 'as:Create'],
    actor: ctx.webId,
    target: invitationRegistry.id,
    label: base.label,
    note: base.note,
    /** live-but-pending link — the workflow PUTs the invitation at this id */
    object: invitationId,
    createdAt: new Date().toISOString(),
  }
  await ActivityRegistry.createActivity(activityRegistry, {
    fetch: ctx.session.fetch,
    randomUUID: ctx.session.randomUUID,
  }, activity)
  return InvitationCreatedMessage.make({
    accepted: true,
    id: IRI.make(invitationId),
    label: base.label,
    note: base.note,
  })
}