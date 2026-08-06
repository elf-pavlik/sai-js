import type { AuthorizationAgent } from '@janeirodigital/interop-authorization-agent'
import type { DataRegistryData, GrantData } from '@janeirodigital/interop-data-model'
import {
  DataRegistry,
  getDataGrantIris,
  getDataGrants,
  Grant,
  ShapeTree,
} from '@janeirodigital/interop-data-model'
import { DataInstance, DataRegistration, DataRegistry as DataRegistrySchema, IRI } from '@janeirodigital/sai-api-messages'
import type * as S from 'effect/Schema'

const buildDataRegistry = async (
  registry: DataRegistryData,
  descriptionsLang: string,
  saiSession: AuthorizationAgent
) => {
  const registrations: S.Schema.Type<typeof DataRegistration>[] = []
  for await (const registration of DataRegistry.registrations(registry, saiSession.factory)) {
    const shapeTree = await saiSession.factory.readable.shapeTree(registration.registeredShapeTree)
    const shapeTreeDescription = descriptionsLang
      ? await ShapeTree.getDescription(shapeTree, descriptionsLang, saiSession.factory)
      : undefined
    registrations.push(
      DataRegistration.make({
        id: IRI.make(registration.id),
        shapeTree: registration.registeredShapeTree,
        dataRegistry: registry.id,
        count: registration.contains.length,
        label: shapeTreeDescription?.label,
      })
    )
  }
  return DataRegistrySchema.make({
    id: IRI.make(registry.id),
    label: await DataRegistry.storageIri(registry, saiSession.factory),
    registrations,
  })
}

const buildDataRegistryForGrant = async (
  registryIri: string,
  dataGrants: GrantData[],
  descriptionsLang: string,
  saiSession: AuthorizationAgent
) => {
  const seen = new Set<string>()
  const registrations: S.Schema.Type<typeof DataRegistration>[] = []
  for (const dataGrant of dataGrants) {
    if (seen.has(dataGrant.hasDataRegistration)) continue
    seen.add(dataGrant.hasDataRegistration)
    const shapeTree = await saiSession.factory.readable.shapeTree(dataGrant.registeredShapeTree)
    const shapeTreeDescription = descriptionsLang
      ? await ShapeTree.getDescription(shapeTree, descriptionsLang, saiSession.factory)
      : undefined
    registrations.push(
      DataRegistration.make({
        id: IRI.make(dataGrant.hasDataRegistration),
        shapeTree: dataGrant.registeredShapeTree,
        dataRegistry: registryIri,
        label: shapeTreeDescription?.label,
      })
    )
  }
  return DataRegistrySchema.make({
    id: IRI.make(registryIri),
    label: dataGrants[0].hasStorage,
    registrations,
  })
}

async function findDataGrantIndex(
  saiSession: AuthorizationAgent,
  agentId: string
): Promise<Record<string, GrantData[]>> {
  const dataGrantIndex: Record<string, GrantData[]> = {}
  for await (const registration of saiSession.socialAgentRegistrations) {
    if (!registration.reciprocalRegistration) continue
    const reciprocalReg = await saiSession.factory.crud.socialAgentRegistration(
      registration.reciprocalRegistration
    )
    if ((await getDataGrantIris(reciprocalReg)).length === 0) continue
    const dataGrants = await getDataGrants(reciprocalReg, saiSession.factory)
    for (const dataGrant of dataGrants) {
      if (dataGrant.dataOwner !== agentId) continue
      const regIri = Grant.dataRegistryIri(dataGrant)
      if (!dataGrantIndex[regIri]) {
        dataGrantIndex[regIri] = []
      }
      dataGrantIndex[regIri].push(dataGrant)
    }
  }
  return dataGrantIndex
}

export const getDataRegistries = async (
  saiSession: AuthorizationAgent,
  agentId: string,
  descriptionsLang: string
) => {
  if (agentId === saiSession.webId) {
    return Promise.all(
      saiSession.registrySet.hasDataRegistry.map((registry) =>
        buildDataRegistry(registry, descriptionsLang, saiSession)
      )
    )
  }
  const socialAgentRegistration = await saiSession.findSocialAgentRegistration(agentId)
  const reciprocalReg = socialAgentRegistration?.reciprocalRegistration
    ? await saiSession.factory.crud.socialAgentRegistration(
        socialAgentRegistration.reciprocalRegistration
      )
    : undefined
  let dataGrantIndex: Record<string, GrantData[]>
  if (reciprocalReg && (await getDataGrantIris(reciprocalReg)).length > 0) {
    const dataGrants = await getDataGrants(reciprocalReg, saiSession.factory)
    dataGrantIndex = dataGrants.reduce(
      (acc, dataGrant) => {
        const regIri = Grant.dataRegistryIri(dataGrant)
        if (!acc[regIri]) {
          acc[regIri] = [] as GrantData[]
        }
        acc[regIri].push(dataGrant)
        return acc
      },
      {} as Record<string, GrantData[]>
    )
  } else {
    dataGrantIndex = await findDataGrantIndex(saiSession, agentId)
  }
  return Promise.all(
    Object.entries(dataGrantIndex).map(([registryIri, dataGrants]) =>
      buildDataRegistryForGrant(registryIri, dataGrants, descriptionsLang, saiSession)
    )
  )
}

export const listDataInstances = async (
  saiSession: AuthorizationAgent,
  agentId: string,
  registrationId: string,
  descriptionsLang = 'en'
) => {
  const dataInstances = []
  if (agentId === saiSession.webId) {
    const dataRegistration = await saiSession.factory.readable.dataRegistration(registrationId)
    for (const dataInstanceIri of dataRegistration.contains) {
      const dataInstance = await saiSession.factory.readable.dataInstance(
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
    const socialAgentRegistration = await saiSession.findSocialAgentRegistration(agentId)
    const reciprocalReg = socialAgentRegistration?.reciprocalRegistration
      ? await saiSession.factory.crud.socialAgentRegistration(
          socialAgentRegistration.reciprocalRegistration
        )
      : undefined
    let dataGrants: GrantData[]
    if (reciprocalReg && (await getDataGrantIris(reciprocalReg)).length > 0) {
      dataGrants = await getDataGrants(reciprocalReg, saiSession.factory)
    } else {
      const dataGrantIndex = await findDataGrantIndex(saiSession, agentId)
      dataGrants = Object.values(dataGrantIndex).flat()
    }
    if (!dataGrants.length) {
      throw new Error(`missing social agent registration: ${agentId}`)
    }
    const seenInstances = new Set<string>()
    for (const dataGrant of dataGrants) {
      if (dataGrant.hasDataRegistration === registrationId) {
        // TODO: optimize not to create crud data instances

        for await (const instance of Grant.getDataInstanceIterator(dataGrant, saiSession.factory)) {
          if (seenInstances.has(instance.iri)) continue
          seenInstances.add(instance.iri)
          const dataInstance = await saiSession.factory.readable.dataInstance(
            instance.iri,
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
