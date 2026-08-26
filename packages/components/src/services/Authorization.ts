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
  DataRegistry,
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
import { findSocialAgentRegistrationInContext, listSocialAgentRegistrations } from './AgentRegistry.js'
import type { ResolvedContext } from './Context.js'
import {
  getDataGrant as getDataGrantFromSparql,
  getSocialAgentRegistration as getRegistrationFromSparql,
} from './queries/org.js'

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
  ctx: ResolvedContext,
  accessNeedGroup: AccessNeedGroupData
) {
  const dataRegistrations = []
  for (const dataRegistry of ctx.registrySet.hasDataRegistry) {
    for (const accessNeed of accessNeedGroup.accessNeeds) {
      for await (const dataRegistration of DataRegistry.registrations(
        dataRegistry,
        ctx.session.factory
      )) {
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
          // @ts-ignore
          count: dataGrant.hasDataInstance
            ? // @ts-ignore
              dataGrant.hasDataInstance.length
            : (await ctx.session.factory.dataRegistration(dataGrant.hasDataRegistration))
                .contains.length,
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
  const personal = ctx.webId === ctx.userWebId
  let accessNeedGroupIriResolved: string
  if (accessNeedGroupIri) {
    accessNeedGroupIriResolved = accessNeedGroupIri
  } else if (agentType === AgentType.Application) {
    const clientIdDocument = await ctx.session.factory.clientIdDocument(agentIri)
    if (!clientIdDocument.hasAccessNeedGroup) return null
    accessNeedGroupIriResolved = clientIdDocument.hasAccessNeedGroup
  } else if (agentType === AgentType.SocialAgent) {
    const socialAgentRegistration = await findSocialAgentRegistrationInContext(ctx, agentIri)
    if (!socialAgentRegistration) throw new Error(`registration not found for ${agentIri}`)
    const reciprocalRegistration = socialAgentRegistration.reciprocalRegistration
      ? personal
        ? await ctx.session.factory.socialAgentRegistration(
            socialAgentRegistration.reciprocalRegistration
          )
        : await getRegistrationFromSparql(
            ctx.session.sparqlEndpoint,
            socialAgentRegistration.reciprocalRegistration
          )
      : undefined
    accessNeedGroupIriResolved = reciprocalRegistration?.hasAccessNeedGroup
    if (!accessNeedGroupIriResolved) return null
  } else if (agentType === AgentType.Role) {
    if (!accessNeedGroupIri) throw new Error('accessNeedGroupIri is required for Role agent type')
  } else throw new Error('wrong agent type')

  const accessNeedGroup = await ctx.session.factory.accessNeedGroup(
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
      id: IRI.make(ctx.webId),
      label: ctx.webId, // TODO get from user's webid document
      dataRegistrations: await findUserDataRegistrations(ctx, accessNeedGroup),
    },
  ]

  for (const socialAgentRegistration of await listSocialAgentRegistrations(ctx)) {
    if (socialAgentRegistration.reciprocalRegistration) {
      const reciprocalRegistration = personal
        ? await ctx.session.factory.socialAgentRegistration(
            socialAgentRegistration.reciprocalRegistration
          )
        : await getRegistrationFromSparql(
            ctx.session.sparqlEndpoint,
            socialAgentRegistration.reciprocalRegistration
          )
      const dataGrants = personal
        ? await getDataGrants(reciprocalRegistration, ctx.session.factory)
        : await Promise.all(
            reciprocalRegistration.hasDataGrant.map((grantIri) =>
              getDataGrantFromSparql(ctx.session.sparqlEndpoint, grantIri)
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
    ...(await AccessNeedGroupModule.reliableDescriptionLanguages(accessNeedGroup, ctx.session.factory)),
  ]
  const reliableDescriptionLanguages = await AccessNeedGroupModule.reliableDescriptionLanguages(
    accessNeedGroup,
    ctx.session.factory
  )
  const descriptionsLang = reliableDescriptionLanguages.has(preferredLang)
    ? preferredLang
    : descriptionLanguages[0]
  const descriptions = await AccessNeedGroupModule.getDescription(
    accessNeedGroup,
    descriptionsLang,
    ctx.session.factory
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
          formatAccessNeed(need, descriptionsLang, ctx.session.factory)
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
  ctx: ResolvedContext,
  authorization: S.Schema.Type<typeof Authorization>
): Promise<S.Schema.Type<typeof AccessAuthorization>> => {
  let structure: AccessAuthorizationStructure
  if (authorization.granted) {
    const accessNeedGroup = await ctx.session.factory.accessNeedGroup(authorization.accessNeedGroup)
    structure = {
      grantee: authorization.grantee,
      hasAccessNeedGroup: authorization.accessNeedGroup,
      dataAuthorizations: buildDataAuthorizations(authorization, accessNeedGroup, ctx.webId),
      granted: true,
    }
  } else {
    structure = {
      grantee: IRI.make(authorization.grantee),
      hasAccessNeedGroup: authorization.accessNeedGroup,
      granted: false,
    }
  }

  // NOTE: `recordAccessAuthorization` writes into the session's own (user's)
  // AuthorizationRegistry — in an org context (`authorizeApp` there is
  // unexercised) it would target the user, not the context; out of the
  // phase-3 exercised scope, tracked as debt.
  const recorded = await ctx.session.recordAccessAuthorization(structure)
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
    if (
      !(await AgentRegistry.findApplicationRegistration(
        ctx.registrySet.hasAgentRegistry,
        ctx.session.factory,
        authorization.grantee
      ))
    ) {
      await AgentRegistry.addApplicationRegistration(
        ctx.registrySet.hasAgentRegistry,
        ctx.session.factory,
        { agent: ctx.webId, client: ctx.session.agentId },
        authorization.grantee
      )
    }
  }
  const activityRegistry = ctx.registrySet.hasActivityRegistry
  if (!activityRegistry) throw new Error('activity registry not found in registry set')
  await ActivityRegistry.createActivity(activityRegistry, ctx.session.factory, {
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
  })
  return response
}
