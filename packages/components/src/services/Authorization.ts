import type {
  AuthorizationAgent,
  AuthorizationStructure,
  DataAuthorizationStructure,
} from '@janeirodigital/interop-authorization-agent'
import {
  AccessNeedGroup as AccessNeedGroupModule,
  AccessNeed as AccessNeedModule,
  ActivityRegistry,
  accessNeedGroup as resolveAccessNeedGroup,
} from '@janeirodigital/interop-authorization-agent'
import {
  type AccessNeedData,
  type AccessNeedGroupData,
  type GrantData,
  ShapeTree,
  type SocialAgentRegistrationData,
  loadClientIdDocument,
  loadShapeTree,
} from '@janeirodigital/interop-data-model'
import { INTEROP, type WhatwgFetch } from '@janeirodigital/interop-utils'
import {
  type AccessAuthorization,
  AccessNeed,
  AgentType,
  type Authorization,
  type AuthorizationData,
  IRI,
} from '@janeirodigital/sai-api-messages'
import type { Brand } from 'effect/Brand'
import type * as S from 'effect/Schema'
import {
  findSocialAgentRegistrationInContext,
  listSocialAgentRegistrations,
} from './AgentRegistry.js'
import type { ResolvedContext } from './Context.js'
import { dataRegistrationContains } from './peerProxy.js'
import {
  getDataGrant as getDataGrantFromSparql,
  getDataRegistration as getDataRegistrationFromSparql,
  getSocialAgentRegistration as getRegistrationFromSparql,
  listDataRegistrations,
  sparqlTransportFor,
} from './queries/org.js'

const formatAccessNeed = async (
  accessNeed: AccessNeedData,
  descriptionsLang: string,
  fetch: WhatwgFetch
): Promise<S.Schema.Type<typeof AccessNeed>> => {
  const description = await AccessNeedModule.getDescription(accessNeed, descriptionsLang, fetch)
  const shapeTree = await loadShapeTree(accessNeed.registeredShapeTree, fetch)
  const shapeTreeDescription = await ShapeTree.getDescription(shapeTree, descriptionsLang, fetch)

  return AccessNeed.make({
    id: IRI.make(accessNeed.id),
    label: description.prefLabel,
    description: description.definition,
    required: accessNeed.required,
    access: accessNeed.accessMode.map((mode) => IRI.make(mode)),
    shapeTree: {
      id: IRI.make(accessNeed.registeredShapeTree),
      label: shapeTreeDescription.prefLabel,
    },
    parent: accessNeed.inheritsFromNeed ? IRI.make(accessNeed.inheritsFromNeed) : undefined,
    children: accessNeed.children
      ? await Promise.all(
          accessNeed.children.map((child) => formatAccessNeed(child, descriptionsLang, fetch))
        )
      : undefined,
  })
}

async function findUserDataRegistrations(
  ctx: ResolvedContext,
  accessNeedGroup: AccessNeedGroupData
) {
  const dataRegistrations = []
  const transport = sparqlTransportFor(ctx)
  for (const dataRegistry of ctx.registrySet.hasDataRegistry) {
    const iris = await listDataRegistrations(transport, dataRegistry.id)
    const registrations = await Promise.all(
      iris.map((iri) => getDataRegistrationFromSparql(transport, iri))
    )
    for (const accessNeed of accessNeedGroup.accessNeeds) {
      for (const dataRegistration of registrations) {
        if (dataRegistration.registeredShapeTree !== accessNeed.registeredShapeTree) continue
        dataRegistrations.push({
          id: IRI.make(dataRegistration.id),
          dataRegistry: IRI.make(dataRegistry.id),
          label: `${dataRegistration.id.split('/').slice(0, 4).join('/')}/`, // TODO get proper label,
          shapeTree: accessNeed.registeredShapeTree,
          count: dataRegistration.contains.length,
        })
        break
      }
    }
  }
  return dataRegistrations
}

async function findSocialAgentDataRegistrations(
  dataGrants: GrantData[],
  accessNeedGroup: AccessNeedGroupData,
  ctx: ResolvedContext
) {
  const dataRegistrations = []
  for (const dataGrant of dataGrants) {
    for (const accessNeed of accessNeedGroup.accessNeeds) {
      if (
        dataGrant.registeredShapeTree === accessNeed.registeredShapeTree &&
        dataGrant.scopeOfGrant !== INTEROP.Inherited // TODO clarify case when this could happen
      ) {
        dataRegistrations.push({
          id: IRI.make(dataGrant.hasDataRegistration),
          label: `${dataGrant.hasDataRegistration.split('/').slice(0, 4).join('/')}/`, // TODO get proper label
          shapeTree: accessNeed.registeredShapeTree,
          // scopeOfGrant is the discriminator — `hasDataInstance` is only
          // set on SelectedFromRegistry grants (empty [] otherwise, which is
          // truthy and used to make the AllFromRegistry count silently 0).
          count:
            dataGrant.scopeOfGrant === INTEROP.SelectedFromRegistry
              ? (dataGrant.hasDataInstance?.length ?? 0)
              : (await dataRegistrationContains(ctx, dataGrant.hasDataRegistration)).length,
        })
      }
    }
  }
  return dataRegistrations
}

/**
 * Get the descriptions for the requested language. If the descriptions for the language are not found
 * `null` will be returned.
 * @param applicationIri application's profile document IRI
 * @param preferredLang XSD language requested, e.g.: "en", "es", "i-navajo".
 * @param saiSession Authoirization Agent from `@janeirodigital/interop-authorization-agent`
 */
export const getDescriptions = async (
  ctx: ResolvedContext,
  agentIri: string,
  agentType: AgentType,
  preferredLang: string,
  accessNeedGroupIri?: string & Brand<'IRI'>
): Promise<S.Schema.Type<typeof AuthorizationData>> => {
  let accessNeedGroupIriResolved: string
  const transport = sparqlTransportFor(ctx)
  if (accessNeedGroupIri) {
    accessNeedGroupIriResolved = accessNeedGroupIri
  } else if (agentType === AgentType.Application) {
    const clientIdDocument = await loadClientIdDocument(agentIri, ctx.session.fetch)
    if (!clientIdDocument.hasAccessNeedGroup) return null
    accessNeedGroupIriResolved = clientIdDocument.hasAccessNeedGroup
  } else if (agentType === AgentType.SocialAgent) {
    const socialAgentRegistration = await findSocialAgentRegistrationInContext(ctx, agentIri)
    if (!socialAgentRegistration) throw new Error(`registration not found for ${agentIri}`)
    const reciprocalRegistration = socialAgentRegistration.reciprocalRegistration
      ? await getRegistrationFromSparql(transport, socialAgentRegistration.reciprocalRegistration)
      : undefined
    accessNeedGroupIriResolved = reciprocalRegistration?.hasAccessNeedGroup
    if (!accessNeedGroupIriResolved) return null
  } else if (agentType === AgentType.Role) {
    if (!accessNeedGroupIri) throw new Error('accessNeedGroupIri is required for Role agent type')
  } else throw new Error('wrong agent type')

  const accessNeedGroup = await resolveAccessNeedGroup(
    accessNeedGroupIriResolved,
    ctx.session.fetch,
    preferredLang
  )

  const dataOwners: {
    id: string & Brand<'IRI'>
    label: string
    dataRegistrations: {
      id: string & Brand<'IRI'>
      dataRegistry?: string & Brand<'IRI'>
      label: string
      shapeTree: string
      count: number
    }[]
  }[] = [
    {
      id: IRI.make(ctx.webId),
      label: ctx.webId, // TODO get from user's webid document
      dataRegistrations: await findUserDataRegistrations(ctx, accessNeedGroup),
    },
  ]

  for (const socialAgentRegistration of await listSocialAgentRegistrations(ctx)) {
    if (socialAgentRegistration.reciprocalRegistration) {
      const reciprocalRegistration = await getRegistrationFromSparql(
        transport,
        socialAgentRegistration.reciprocalRegistration
      )
      const dataGrants = await Promise.all(
        reciprocalRegistration.hasDataGrant.map((grantIri) =>
          getDataGrantFromSparql(transport, grantIri)
        )
      )
      const dataRegistrations = await findSocialAgentDataRegistrations(
        dataGrants,
        accessNeedGroup,
        ctx
      )
      if (dataRegistrations.length) {
        dataOwners.push({
          id: IRI.make(socialAgentRegistration.registeredAgent),
          label: socialAgentRegistration.prefLabel,
          dataRegistrations,
        })
      }
    }
  }
  const descriptionLanguages = [
    ...(await AccessNeedGroupModule.reliableDescriptionLanguages(
      accessNeedGroup,
      ctx.session.fetch
    )),
  ]
  const reliableDescriptionLanguages = await AccessNeedGroupModule.reliableDescriptionLanguages(
    accessNeedGroup,
    ctx.session.fetch
  )
  const descriptionsLang = reliableDescriptionLanguages.has(preferredLang)
    ? preferredLang
    : descriptionLanguages[0]
  const descriptions = await AccessNeedGroupModule.getDescription(
    accessNeedGroup,
    descriptionsLang,
    ctx.session.fetch
  )

  return {
    // TODO if the id is the unique id of something then it should not be its own id. It should refer by a different name,
    //      e.g.: applicationId and be documented as such
    id: IRI.make(agentIri), // TODO change to agentID
    agentType,
    accessNeedGroup: {
      id: IRI.make(accessNeedGroup.id),
      label: descriptions.prefLabel,
      description: descriptions.definition,
      needs: await Promise.all(
        accessNeedGroup.accessNeeds.map((need) =>
          formatAccessNeed(need, descriptionsLang, ctx.session.fetch)
        )
      ),
      descriptionLanguages,
      lang: descriptionsLang,
    },
    dataOwners,
  }
}

export const recordAuthorization = async (
  ctx: ResolvedContext,
  authorization: S.Schema.Type<typeof Authorization>
): Promise<S.Schema.Type<typeof AccessAuthorization>> => {
  // thin adapter: the RPC shape → the AA's AuthorizationStructure (field
  // copies); the SAI rules (scope mapping, dataOwner assignment, inheritance
  // wiring, ensure-Application-Registration) live in the AA session method
  // recordAuthorizationFromStructure
  const structure: AuthorizationStructure = {
    grantee: authorization.grantee,
    agentType: authorization.agentType,
    hasAccessNeedGroup: authorization.accessNeedGroup,
    granted: authorization.granted,
    dataAuthorizations: authorization.granted
      ? (authorization.dataAuthorizations.map((dataAuthorization) => ({
          accessNeed: dataAuthorization.accessNeed,
          // adapter maps the RPC short scope name to the interop IRI
          scopeOfAuthorization: INTEROP[dataAuthorization.scope],
          dataOwner: dataAuthorization.dataOwner,
          hasDataRegistration: dataAuthorization.dataRegistration,
          hasDataInstance: dataAuthorization.dataInstances
            ? [...dataAuthorization.dataInstances]
            : undefined,
        })) satisfies DataAuthorizationStructure[])
      : undefined,
  }
  const recorded = await ctx.session.recordAuthorizationFromStructure(
    structure,
    ctx.webId,
    ctx.registrySet
  )
  const response: S.Schema.Type<typeof AccessAuthorization> = recorded.map((dataAuthorization) => ({
    id: IRI.make(dataAuthorization.id),
    grantee: IRI.make(dataAuthorization.grantee),
    grantedBy: IRI.make(dataAuthorization.grantedBy),
    registeredShapeTree: IRI.make(dataAuthorization.registeredShapeTree),
    scopeOfAuthorization: IRI.make(dataAuthorization.scopeOfAuthorization),
    dataOwner: dataAuthorization.dataOwner ? IRI.make(dataAuthorization.dataOwner) : undefined,
    hasDataRegistration: dataAuthorization.hasDataRegistration
      ? IRI.make(dataAuthorization.hasDataRegistration)
      : undefined,
    satisfiesAccessNeed: dataAuthorization.satisfiesAccessNeed
      ? IRI.make(dataAuthorization.satisfiesAccessNeed)
      : undefined,
    inheritsFromAuthorization: dataAuthorization.inheritsFromAuthorization
      ? IRI.make(dataAuthorization.inheritsFromAuthorization)
      : undefined,
    accessMode: dataAuthorization.accessMode.map((mode) => IRI.make(mode)),
    creatorAccessMode: dataAuthorization.creatorAccessMode
      ? dataAuthorization.creatorAccessMode.map((mode) => IRI.make(mode))
      : undefined,
    hasDataInstance: dataAuthorization.hasDataInstance
      ? dataAuthorization.hasDataInstance.map((iri) => IRI.make(iri))
      : undefined,
    hasInheritingAuthorization: dataAuthorization.hasInheritingAuthorization
      ? dataAuthorization.hasInheritingAuthorization.map((iri) => IRI.make(iri))
      : undefined,
  }))

  const activityRegistry = ctx.registrySet.hasActivityRegistry
  if (!activityRegistry) throw new Error('activity registry not found in registry set')
  await ActivityRegistry.createActivity(
    activityRegistry,
    { fetch: ctx.session.fetch, randomUUID: ctx.session.randomUUID },
    {
      activityType: 'authorizationRecorded',
      target: ctx.registrySet.hasAuthorizationRegistry.id,
      payload: {
        webId: { id: ctx.webId, type: [INTEROP.SocialAgent] },
        authorizationGrantee: {
          id: authorization.grantee,
          type: [authorization.agentType],
        },
      },
      createdAt: new Date().toISOString(),
    }
  )
  return response
}
