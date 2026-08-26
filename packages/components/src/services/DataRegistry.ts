import type { GrantData } from '@janeirodigital/interop-data-model'
import {
  DataRegistry as DataRegistryModule,
  getDataGrants,
  Grant,
  ShapeTree,
} from '@janeirodigital/interop-data-model'
import { DataInstance, DataRegistration, DataRegistry as DataRegistrySchema, IRI } from '@janeirodigital/sai-api-messages'
import type * as S from 'effect/Schema'
import {
  findSocialAgentRegistrationInContext,
  listSocialAgentRegistrations,
} from './AgentRegistry.js'
import type { ResolvedContext } from './Context.js'
import {
  getDataGrant as getDataGrantFromSparql,
  getSocialAgentRegistration as getRegistrationFromSparql,
} from './queries/org.js'

const buildDataRegistry = async (
  registry: { id: string },
  descriptionsLang: string,
  ctx: ResolvedContext
) => {
  const registrations: S.Schema.Type<typeof DataRegistration>[] = []
  for await (const registration of DataRegistryModule.registrations(registry, ctx.session.factory)) {
    const shapeTree = await ctx.session.factory.shapeTree(registration.registeredShapeTree)
    const shapeTreeDescription = descriptionsLang
      ? await ShapeTree.getDescription(shapeTree, descriptionsLang, ctx.session.factory)
      : undefined
    registrations.push(
      DataRegistration.make({
        id: IRI.make(registration.id),
        shapeTree: registration.registeredShapeTree,
        dataRegistry: registry.id,
        count: registration.contains.length,
        label: shapeTreeDescription?.prefLabel,
      })
    )
  }
  return DataRegistrySchema.make({
    id: IRI.make(registry.id),
    label: await DataRegistryModule.storageIri(registry, ctx.session.factory),
    registrations,
  })
}

const buildDataRegistryForGrant = async (
  registryIri: string,
  dataGrants: GrantData[],
  descriptionsLang: string,
  ctx: ResolvedContext
) => {
  const seen = new Set<string>()
  const registrations: S.Schema.Type<typeof DataRegistration>[] = []
  for (const dataGrant of dataGrants) {
    if (seen.has(dataGrant.hasDataRegistration)) continue
    seen.add(dataGrant.hasDataRegistration)
    const shapeTree = await ctx.session.factory.shapeTree(dataGrant.registeredShapeTree)
    const shapeTreeDescription = descriptionsLang
      ? await ShapeTree.getDescription(shapeTree, descriptionsLang, ctx.session.factory)
      : undefined
    registrations.push(
      DataRegistration.make({
        id: IRI.make(dataGrant.hasDataRegistration),
        shapeTree: dataGrant.registeredShapeTree,
        dataRegistry: registryIri,
        label: shapeTreeDescription?.prefLabel,
      })
    )
  }
  return DataRegistrySchema.make({
    id: IRI.make(registryIri),
    label: dataGrants[0].hasStorage,
    registrations,
  })
}

/**
 * The data grants the context has for `agentId` (peer branch). Direct
 * routing: the reciprocal of the context's registration of `agentId`, then
 * its linked grants — via SPARQL in org context (peer `.acr`s never grant
 * the admin), via the factory in personal context. Fallback scan (preserved
 * from `findDataGrantIndex`): any registration's reciprocal grants that
 * name `agentId` as `dataOwner`.
 */
async function dataGrantIndexForAgent(
  ctx: ResolvedContext,
  agentId: string
): Promise<Record<string, GrantData[]>> {
  const personal = ctx.webId === ctx.userWebId
  const directGrants = await (async () => {
    const socialAgentRegistration = await findSocialAgentRegistrationInContext(ctx, agentId)
    if (!socialAgentRegistration?.reciprocalRegistration) return []
    if (personal) {
      const reciprocalReg = await ctx.session.factory.socialAgentRegistration(
        socialAgentRegistration.reciprocalRegistration
      )
      return getDataGrants(reciprocalReg, ctx.session.factory)
    }
    const reciprocalReg = await getRegistrationFromSparql(
      ctx.session.sparqlEndpoint,
      socialAgentRegistration.reciprocalRegistration
    )
    return Promise.all(
      reciprocalReg.hasDataGrant.map((grantIri) =>
        getDataGrantFromSparql(ctx.session.sparqlEndpoint, grantIri)
      )
    )
  })()

  const indexFromGrants = (dataGrants: GrantData[]): Record<string, GrantData[]> =>
    dataGrants.reduce(
      (acc, dataGrant) => {
        const regIri = Grant.dataRegistryIri(dataGrant)
        if (!acc[regIri]) acc[regIri] = [] as GrantData[]
        acc[regIri].push(dataGrant)
        return acc
      },
      {} as Record<string, GrantData[]>
    )

  const directIndex = indexFromGrants(directGrants)
  if (Object.keys(directIndex).length > 0) return directIndex

  // fallback: scan every context registration's reciprocal grants for `dataOwner === agentId`
  const scanned: GrantData[] = []
  for (const registration of await listSocialAgentRegistrations(ctx)) {
    if (!registration.reciprocalRegistration) continue
    const grants = personal
      ? await (async () => {
          const reciprocalReg = await ctx.session.factory.socialAgentRegistration(
            registration.reciprocalRegistration
          )
          return getDataGrants(reciprocalReg, ctx.session.factory)
        })()
      : await getReciprocalGrantsSparql(ctx, registration.reciprocalRegistration)
    scanned.push(...grants.filter((grant) => grant.dataOwner === agentId))
  }
  return indexFromGrants(scanned)
}

async function getReciprocalGrantsSparql(
  ctx: ResolvedContext,
  reciprocalIri: string
): Promise<GrantData[]> {
  const reciprocalReg = await getRegistrationFromSparql(ctx.session.sparqlEndpoint, reciprocalIri)
  return Promise.all(
    reciprocalReg.hasDataGrant.map((grantIri) =>
      getDataGrantFromSparql(ctx.session.sparqlEndpoint, grantIri)
    )
  )
}

export const getDataRegistries = async (
  ctx: ResolvedContext,
  agentId: string,
  descriptionsLang: string
) => {
  if (agentId === ctx.webId) {
    return Promise.all(
      ctx.registrySet.hasDataRegistry.map((registry) =>
        buildDataRegistry(registry, descriptionsLang, ctx)
      )
    )
  }
  const dataGrantIndex = await dataGrantIndexForAgent(ctx, agentId)
  return Promise.all(
    Object.entries(dataGrantIndex).map(([registryIri, dataGrants]) =>
      buildDataRegistryForGrant(registryIri, dataGrants, descriptionsLang, ctx)
    )
  )
}

export const listDataInstances = async (
  ctx: ResolvedContext,
  agentId: string,
  registrationId: string,
  descriptionsLang = 'en'
) => {
  const dataInstances = []
  if (agentId === ctx.webId) {
    const dataRegistration = await ctx.session.factory.dataRegistration(registrationId)
    for (const dataInstanceIri of dataRegistration.contains) {
      const dataInstance = await ctx.session.factory.dataInstance(
        dataInstanceIri,
        undefined,
        descriptionsLang
      )
      dataInstances.push(
        DataInstance.make({
          id: IRI.make(dataInstance.id),
          label: dataInstance.label,
        })
      )
    }
  } else {
    const socialAgentRegistration = await findSocialAgentRegistrationInContext(ctx, agentId)
    const reciprocalReg = socialAgentRegistration?.reciprocalRegistration
      ? // §2.4 known issue: peer *instance content* stays HTTP and 403s for
        // non-owners; the reciprocal/grant list here resolves via SPARQL
        // in org context.
        ctx.webId === ctx.userWebId
          ? await ctx.session.factory.socialAgentRegistration(
              socialAgentRegistration.reciprocalRegistration
            )
          : await getRegistrationFromSparql(
              ctx.session.sparqlEndpoint,
              socialAgentRegistration.reciprocalRegistration
            )
      : undefined
    let dataGrants: GrantData[]
    if (reciprocalReg && reciprocalReg.hasDataGrant.length > 0) {
      dataGrants =
        ctx.webId === ctx.userWebId
          ? await getDataGrants(reciprocalReg, ctx.session.factory)
          : await Promise.all(
              reciprocalReg.hasDataGrant.map((grantIri) =>
                getDataGrantFromSparql(ctx.session.sparqlEndpoint, grantIri)
              )
            )
    } else {
      dataGrants = Object.values(await dataGrantIndexForAgent(ctx, agentId)).flat()
    }
    if (!dataGrants.length) {
      throw new Error(`missing social agent registration: ${agentId}`)
    }
    const seenInstances = new Set<string>()
    for (const dataGrant of dataGrants) {
      if (dataGrant.hasDataRegistration === registrationId) {
        for await (const instanceIri of Grant.getDataInstanceIterator(
          dataGrant,
          ctx.session.factory
        )) {
          if (seenInstances.has(instanceIri)) continue
          seenInstances.add(instanceIri)
          const dataInstance = await ctx.session.factory.dataInstance(
            instanceIri,
            dataGrant.registeredShapeTree,
            descriptionsLang
          )
          dataInstances.push(
            DataInstance.make({
              id: IRI.make(dataInstance.id),
              label: dataInstance.label,
            })
          )
        }
      }
    }
  }

  return dataInstances
}
