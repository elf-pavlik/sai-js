import type {
  AuthorizationAgent,
  ShareDataInstanceStructure,
} from '@janeirodigital/interop-authorization-agent'
import {
  IRI,
  Resource,
  type ShareAuthorization,
  type ShareAuthorizationConfirmation,
} from '@janeirodigital/sai-api-messages'
import { ShapeTree } from '@janeirodigital/interop-data-model'
import type * as S from 'effect/Schema'
import { Temporal } from '../temporal/client.js'
import { createGrantsForAuthorization } from '../temporal/workflows/grants.js'

export const getResource = async (saiSession: AuthorizationAgent, iri: string, lang: string) => {
  const resource = await saiSession.factory.readable.dataInstance(iri, undefined, lang)
  if (!resource) throw new Error(`Resource not found: ${iri}`)
  const shapeTree = await saiSession.factory.readable.shapeTree(resource.shapeTreeIri)
  const shapeTreeDescription = await ShapeTree.getDescription(shapeTree, lang, saiSession.factory)
  return Resource.make({
    id: IRI.make(resource.id),
    label: resource.label,
    shapeTree: {
      id: IRI.make(resource.shapeTreeIri),
      label: shapeTreeDescription?.label,
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

  const clientIdDocument = await saiSession.factory.readable.clientIdDocument(
    shareAuthorization.applicationId
  )

  // group recorded data authorizations by grantee
  const grouped = new Map<string, string[]>()
  for (const dataAuthorization of recorded) {
    const iris = grouped.get(dataAuthorization.grantee) ?? []
    iris.push(dataAuthorization.id)
    grouped.set(dataAuthorization.grantee, iris)
  }

  // TODO: consider a single workflow that will fire-and-forget all the child workflows
  const temporal = new Temporal()
  await temporal.init()
  await Promise.all(
    [...grouped.entries()].map(([grantee, dataAuthorizationIris]) =>
      temporal.client.workflow.start(createGrantsForAuthorization, {
        taskQueue: 'create-grants',
        args: [
          {
            webId: saiSession.webId,
            authorizationGrantee: grantee,
            dataAuthorizationIris,
          },
        ],
        workflowId: crypto.randomUUID(),
      })
    )
  )

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
  const clientIdDocument = await saiSession.factory.readable.clientIdDocument(applicationIri)
  await socialAgentRegistration.setAccessNeedGroup(clientIdDocument.hasAccessNeedGroup)
}
