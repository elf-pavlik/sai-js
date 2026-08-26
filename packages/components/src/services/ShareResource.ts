import type {
  AuthorizationAgent,
  ShareDataInstanceStructure,
} from '@janeirodigital/interop-authorization-agent'
import { ActivityRegistry, ShapeTree, setAccessNeedGroup } from '@janeirodigital/interop-data-model'
import { INTEROP } from '@janeirodigital/interop-utils'
import {
  IRI,
  Resource,
  type ShareAuthorization,
  type ShareAuthorizationConfirmation,
} from '@janeirodigital/sai-api-messages'
import type * as S from 'effect/Schema'
import { findSocialAgentRegistrationInContext } from './AgentRegistry.js'
import type { ResolvedContext } from './Context.js'

export const getResource = async (ctx: ResolvedContext, iri: string, lang: string) => {
  const resource = await ctx.session.factory.dataInstance(iri, undefined, lang)
  if (!resource) throw new Error(`Resource not found: ${iri}`)
  const shapeTree = await ctx.session.factory.shapeTree(resource.shapeTreeIri)
  const shapeTreeDescription = await ShapeTree.getDescription(shapeTree, lang, ctx.session.factory)
  return Resource.make({
    id: IRI.make(resource.id),
    label: resource.label,
    shapeTree: {
      id: IRI.make(resource.shapeTreeIri),
      label: shapeTreeDescription?.prefLabel,
    },
    accessGrantedTo: (await ctx.session.findSocialAgentsWithAccess(resource.id)).map(({ agent }) =>
      IRI.make(agent)
    ),
    children: resource.children.map((child) => ({
      shapeTree: {
        id: IRI.make(child.shapeTree.iri),
        label: child.shapeTree.label,
      },
      count: child.count,
    })),
  })
}

export const shareResource = async (
  ctx: ResolvedContext,
  shareAuthorization: S.Schema.Type<typeof ShareAuthorization>
): Promise<S.Schema.Type<typeof ShareAuthorizationConfirmation>> => {
  // TODO: finde cleaner way of dealing with types
  // `shareDataInstance` writes on the session's own registry set — in an org
  // context (unexercised) it would target the user's; out of the phase-3
  // exercised scope, tracked as debt.
  const recorded = await ctx.session.shareDataInstance(
    shareAuthorization as unknown as ShareDataInstanceStructure
  )

  const clientIdDocument = await ctx.session.factory.clientIdDocument(
    shareAuthorization.applicationId
  )

  // grantees are social agents in the share flow (roles are not share targets)
  const grantees = [...new Set(recorded.map((dataAuthorization) => dataAuthorization.grantee))]

  // one authorizationRecorded activity per deduped grantee → one notification,
  // one workflow per grantee (sequential PUTs — CSS SPARQL backend races on
  // concurrent PUTs in the same container)
  const activityRegistry = ctx.registrySet.hasActivityRegistry
  if (!activityRegistry) throw new Error('activity registry not found in registry set')
  for (const grantee of grantees) {
    await ActivityRegistry.createActivity(activityRegistry, ctx.session.factory, {
      activityType: 'authorizationRecorded',
      target: ctx.registrySet.hasAuthorizationRegistry.id,
      payload: {
        webId: { id: ctx.webId, type: [INTEROP.SocialAgent] },
        authorizationGrantee: { id: grantee, type: [INTEROP.SocialAgent] },
      },
      createdAt: new Date().toISOString(),
    })
  }

  return {
    callbackEndpoint: clientIdDocument.callbackEndpoint!,
  }
}

export async function requestAccessUsingApplicationNeeds(
  ctx: ResolvedContext,
  applicationIri: string,
  webId: string
): Promise<void> {
  const socialAgentRegistration = await findSocialAgentRegistrationInContext(ctx, webId)
  const clientIdDocument = await ctx.session.factory.clientIdDocument(applicationIri)
  await setAccessNeedGroup(
    socialAgentRegistration,
    ctx.session.factory,
    clientIdDocument.hasAccessNeedGroup
  )
}