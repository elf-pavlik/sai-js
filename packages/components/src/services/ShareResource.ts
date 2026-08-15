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

export const getResource = async (saiSession: AuthorizationAgent, iri: string, lang: string) => {
  const resource = await saiSession.factory.dataInstance(iri, undefined, lang)
  if (!resource) throw new Error(`Resource not found: ${iri}`)
  const shapeTree = await saiSession.factory.shapeTree(resource.shapeTreeIri)
  const shapeTreeDescription = await ShapeTree.getDescription(shapeTree, lang, saiSession.factory)
  return Resource.make({
    id: IRI.make(resource.id),
    label: resource.label,
    shapeTree: {
      id: IRI.make(resource.shapeTreeIri),
      label: shapeTreeDescription?.prefLabel,
    },
    accessGrantedTo: (await saiSession.findSocialAgentsWithAccess(resource.id)).map(({ agent }) =>
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
  saiSession: AuthorizationAgent,
  shareAuthorization: S.Schema.Type<typeof ShareAuthorization>
): Promise<S.Schema.Type<typeof ShareAuthorizationConfirmation>> => {
  // TODO: finde cleaner way of dealing with types
  const recorded = await saiSession.shareDataInstance(
    shareAuthorization as unknown as ShareDataInstanceStructure
  )

  const clientIdDocument = await saiSession.factory.clientIdDocument(
    shareAuthorization.applicationId
  )

  // grantees are social agents in the share flow (roles are not share targets)
  const grantees = [...new Set(recorded.map((dataAuthorization) => dataAuthorization.grantee))]

  // one authorizationRecorded activity per deduped grantee → one notification,
  // one workflow per grantee (sequential PUTs — CSS SPARQL backend races on
  // concurrent PUTs in the same container)
  const activityRegistry = saiSession.registrySet.hasActivityRegistry
  if (!activityRegistry) throw new Error('activity registry not found in registry set')
  for (const grantee of grantees) {
    await ActivityRegistry.createActivity(activityRegistry, saiSession.factory, {
      activityType: 'authorizationRecorded',
      target: saiSession.registrySet.hasAuthorizationRegistry.id,
      payload: {
        webId: { id: saiSession.webId, type: [INTEROP.SocialAgent] },
        authorizationGrantee: { id: grantee, type: [INTEROP.SocialAgent] },
      },
      status: 'pending',
      createdAt: new Date().toISOString(),
    })
  }

  return {
    callbackEndpoint: clientIdDocument.callbackEndpoint!,
  }
}

export async function requestAccessUsingApplicationNeeds(
  saiSession: AuthorizationAgent,
  applicationIri: string,
  webId: string
): Promise<void> {
  const socialAgentRegistration = await saiSession.findSocialAgentRegistration(webId)
  const clientIdDocument = await saiSession.factory.clientIdDocument(applicationIri)
  await setAccessNeedGroup(
    socialAgentRegistration,
    saiSession.factory,
    clientIdDocument.hasAccessNeedGroup
  )
}
