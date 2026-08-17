import type {
  AccessAuthorizationStructure,
  AuthorizationAgent,
  NestedDataAuthorizationData,
} from '@janeirodigital/interop-authorization-agent'
import {
  type AccessNeedData,
  type AccessNeedGroupData,
  AccessNeedGroup as AccessNeedGroupModule,
  AccessNeed as AccessNeedModule,
  AgentRegistry,
  ActivityRegistry,
  type DataAuthorizationData,
  type GrantData,
  ShapeTree,
  type SocialAgentRegistrationData,
  getDataGrantIris,
  getDataGrants,
} from '@janeirodigital/interop-data-model'
import type { AuthorizationAgentFactory } from '@janeirodigital/interop-data-model'
import { INTEROP } from '@janeirodigital/interop-utils'
import {
  type AccessAuthorization,
  AccessNeed,
  AgentType,
  type Authorization,
  type AuthorizationData,
  type GrantedAuthorization,
  IRI,
} from '@janeirodigital/sai-api-messages'
import type { Brand } from 'effect/Brand'
import type * as S from 'effect/Schema'

const formatAccessNeed = async (
  accessNeed: AccessNeedData,
  descriptionsLang: string,
  factory: AuthorizationAgentFactory
): Promise<S.Schema.Type<typeof AccessNeed>> => {
  const description = await AccessNeedModule.getDescription(accessNeed, descriptionsLang, factory)
  const shapeTree = await factory.shapeTree(accessNeed.registeredShapeTree)
  const shapeTreeDescription = await ShapeTree.getDescription(shapeTree, descriptionsLang, factory)

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
          accessNeed.children.map((child) => formatAccessNeed(child, descriptionsLang, factory))
        )
      : undefined,
  })
}

async function findUserDataRegistrations(
  accessNeedGroup: AccessNeedGroupData,
  saiSession: AuthorizationAgent
) {
  const dataRegistrations = []
  for (const dataRegistry of saiSession.registrySet.hasDataRegistry) {
    for (const accessNeed of accessNeedGroup.accessNeeds) {
      const dataRegistration = await saiSession.findDataRegistration(
        dataRegistry.id,
        accessNeed.registeredShapeTree
      )
      if (dataRegistration)
        dataRegistrations.push({
          id: IRI.make(dataRegistration.id),
          dataRegistry: IRI.make(dataRegistry.id),
          label: `${dataRegistration.id.split('/').slice(0, 4).join('/')}/`, // TODO get proper label,
          shapeTree: accessNeed.registeredShapeTree,
          count: dataRegistration.contains.length,
        })
    }
  }
  return dataRegistrations
}

async function findSocialAgentDataRegistrations(
  socialAgentRegistration: SocialAgentRegistrationData,
  accessNeedGroup: AccessNeedGroupData,
  saiSession: AuthorizationAgent
) {
  const dataRegistrations = []
  if ((await getDataGrantIris(socialAgentRegistration)).length === 0) return []
  const dataGrants = await getDataGrants(socialAgentRegistration, saiSession.factory)
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
          // @ts-ignore
          count: dataGrant.hasDataInstance
            ? // @ts-ignore
              dataGrant.hasDataInstance.length
            : (await saiSession.factory.dataRegistration(dataGrant.hasDataRegistration)).contains
                .length,
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
  saiSession: AuthorizationAgent,
  agentIri: string,
  agentType: AgentType,
  preferredLang: string,
  accessNeedGroupIri?: string & Brand<'IRI'>
): Promise<S.Schema.Type<typeof AuthorizationData>> => {
  let accessNeedGroupIriResolved: string
  if (accessNeedGroupIri) {
    accessNeedGroupIriResolved = accessNeedGroupIri
  } else if (agentType === AgentType.Application) {
    const clientIdDocument = await saiSession.factory.clientIdDocument(agentIri)
    if (!clientIdDocument.hasAccessNeedGroup) return null
    accessNeedGroupIriResolved = clientIdDocument.hasAccessNeedGroup
  } else if (agentType === AgentType.SocialAgent) {
    const socialAgentRegistration = await saiSession.findSocialAgentRegistration(agentIri)
    if (!socialAgentRegistration) throw new Error(`registration not found for ${agentIri}`)
    const reciprocalRegistration = socialAgentRegistration.reciprocalRegistration
      ? await saiSession.factory.socialAgentRegistration(
          socialAgentRegistration.reciprocalRegistration
        )
      : undefined
    accessNeedGroupIriResolved = reciprocalRegistration?.hasAccessNeedGroup
    if (!accessNeedGroupIriResolved) return null
  } else if (agentType === AgentType.Role) {
    if (!accessNeedGroupIri) throw new Error('accessNeedGroupIri is required for Role agent type')
  } else throw new Error('wrong agent type')

  const accessNeedGroup = await saiSession.factory.accessNeedGroup(
    accessNeedGroupIriResolved,
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
      id: IRI.make(saiSession.webId),
      label: saiSession.webId, // TODO get from user's webid document
      dataRegistrations: await findUserDataRegistrations(accessNeedGroup, saiSession),
    },
  ]

  for await (const socialAgentRegistration of saiSession.socialAgentRegistrations) {
    if (socialAgentRegistration.reciprocalRegistration) {
      const reciprocalRegistration = await saiSession.factory.socialAgentRegistration(
        socialAgentRegistration.reciprocalRegistration
      )
      const dataRegistrations = await findSocialAgentDataRegistrations(
        reciprocalRegistration,
        accessNeedGroup,
        saiSession
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
      saiSession.factory
    )),
  ]
  const reliableDescriptionLanguages = await AccessNeedGroupModule.reliableDescriptionLanguages(
    accessNeedGroup,
    saiSession.factory
  )
  const descriptionsLang = reliableDescriptionLanguages.has(preferredLang)
    ? preferredLang
    : descriptionLanguages[0]
  const descriptions = await AccessNeedGroupModule.getDescription(
    accessNeedGroup,
    descriptionsLang,
    saiSession.factory
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
          formatAccessNeed(need, descriptionsLang, saiSession.factory)
        )
      ),
      descriptionLanguages,
      lang: descriptionsLang,
    },
    dataOwners,
  }
}

// currently the spec only anticipates one level of inheritance
// since we still don't have IRIs at this point, we need to use nesting to represent inheritance
// TODO validate all scopes
function buildDataAuthorizations(
  authorization: S.Schema.Type<typeof GrantedAuthorization>,
  accessNeedGroup: AccessNeedGroupData,
  grantedBy: string
): NestedDataAuthorizationData[] {
  const structuredDataAuthorizations = authorization.dataAuthorizations.map((dataAuthorization) => {
    const accessNeed = accessNeedGroup.accessNeeds
      .flatMap((need) => [need, ...(need.children ?? [])])
      .find((need) => need.id === dataAuthorization.accessNeed)
    if (!accessNeed) {
      throw new Error(`missing access need: ${dataAuthorization.accessNeed}`)
    }
    const saiReady: DataAuthorizationData = {
      type: [INTEROP.DataAuthorization],
      satisfiesAccessNeed: accessNeed.id,
      grantee: authorization.grantee,
      grantedBy,
      registeredShapeTree: accessNeed.registeredShapeTree,
      scopeOfAuthorization: INTEROP[dataAuthorization.scope],
      accessMode: accessNeed!.accessMode,
    }
    if (
      saiReady.scopeOfAuthorization !== INTEROP.All &&
      saiReady.scopeOfAuthorization !== INTEROP.Inherited
    ) {
      saiReady.dataOwner = dataAuthorization.dataOwner
    }
    if (saiReady.scopeOfAuthorization === INTEROP.AllFromRegistry) {
      saiReady.hasDataRegistration = dataAuthorization.dataRegistration
    } else if (saiReady.scopeOfAuthorization === INTEROP.SelectedFromRegistry) {
      saiReady.hasDataRegistration = dataAuthorization.dataRegistration
      saiReady.hasDataInstance = dataAuthorization.dataInstances as unknown as string[]
    }
    return saiReady
  })
  const parents: NestedDataAuthorizationData[] = []
  const children: DataAuthorizationData[] = []
  for (const structuredDataAuthorization of structuredDataAuthorizations) {
    if (structuredDataAuthorization.scopeOfAuthorization === INTEROP.Inherited) {
      children.push(structuredDataAuthorization)
    } else {
      parents.push(structuredDataAuthorization)
    }
  }
  return parents.map((parentDataAuthorization) => {
    // add children for each parent
    const inheritingDataAuthorizations = children
      .filter((childDataAuthorization) => {
        const accessNeed = accessNeedGroup.accessNeeds
          .flatMap((need) => [need, ...(need.children ?? [])])
          .find((need) => need.id === childDataAuthorization.satisfiesAccessNeed)!

        return accessNeed.inheritsFromNeed === parentDataAuthorization.satisfiesAccessNeed
      })
      .map((child) => ({ ...child, dataOwner: parentDataAuthorization.dataOwner }))
    if (inheritingDataAuthorizations.length) {
      return { ...parentDataAuthorization, children: inheritingDataAuthorizations }
    }
    return parentDataAuthorization
  })
}

export const recordAuthorization = async (
  saiSession: AuthorizationAgent,
  authorization: S.Schema.Type<typeof Authorization>
): Promise<S.Schema.Type<typeof AccessAuthorization>> => {
  let structure: AccessAuthorizationStructure
  if (authorization.granted) {
    const accessNeedGroup = await saiSession.factory.accessNeedGroup(authorization.accessNeedGroup)
    structure = {
      grantee: authorization.grantee,
      hasAccessNeedGroup: authorization.accessNeedGroup,
      dataAuthorizations: buildDataAuthorizations(authorization, accessNeedGroup, saiSession.webId),
      granted: true,
    }
  } else {
    structure = {
      grantee: IRI.make(authorization.grantee),
      hasAccessNeedGroup: authorization.accessNeedGroup,
      granted: false,
    }
  }

  const recorded = await saiSession.recordAccessAuthorization(structure)
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

  if (authorization.agentType === AgentType.Application) {
    // we need to ensure that Application Registration exists before generating Access Grant!
    // TODO: extract
    if (!(await saiSession.findApplicationRegistration(authorization.grantee))) {
      await AgentRegistry.addApplicationRegistration(
        saiSession.registrySet.hasAgentRegistry,
        saiSession.factory,
        { agent: saiSession.webId, client: saiSession.agentId },
        authorization.grantee
      )
    }
  }
  const activityRegistry = saiSession.registrySet.hasActivityRegistry
  if (!activityRegistry) throw new Error('activity registry not found in registry set')
  await ActivityRegistry.createActivity(activityRegistry, saiSession.factory, {
    activityType: 'authorizationRecorded',
    target: saiSession.registrySet.hasAuthorizationRegistry.id,
    payload: {
      webId: { id: saiSession.webId, type: [INTEROP.SocialAgent] },
      authorizationGrantee: {
        id: authorization.grantee,
        type: [authorization.agentType],
      },
    },
    createdAt: new Date().toISOString(),
  })
  return response
}
