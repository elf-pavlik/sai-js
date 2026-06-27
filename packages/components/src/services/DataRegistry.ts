import type { AuthorizationAgent } from '@janeirodigital/interop-authorization-agent'
import type { CRUDDataRegistry, DataGrant } from '@janeirodigital/interop-data-model'
import { DataInstance, DataRegistration, DataRegistry, IRI } from '@janeirodigital/sai-api-messages'
import type * as S from 'effect/Schema'

const buildDataRegistry = async (
  registry: CRUDDataRegistry,
  descriptionsLang: string,
  saiSession: AuthorizationAgent
) => {
  const registrations: S.Schema.Type<typeof DataRegistration>[] = []
  for await (const registration of registry.registrations) {
    const shapeTree = await saiSession.factory.readable.shapeTree(
      registration.registeredShapeTree,
      descriptionsLang
    )
    registrations.push(
      DataRegistration.make({
        id: IRI.make(registration.iri),
        shapeTree: registration.registeredShapeTree,
        dataRegistry: registry.iri,
        count: registration.contains.length,
        label: shapeTree.descriptions[descriptionsLang]?.label,
      })
    )
  }
  return DataRegistry.make({
    id: IRI.make(registry.iri),
    label: await registry.storageIri(),
    registrations,
  })
}

const buildDataRegistryForGrant = async (
  registryIri: string,
  dataGrants: DataGrant[],
  descriptionsLang: string,
  saiSession: AuthorizationAgent
) => {
  const seen = new Set<string>()
  const registrations: S.Schema.Type<typeof DataRegistration>[] = []
  for (const dataGrant of dataGrants) {
    if (seen.has(dataGrant.hasDataRegistration)) continue
    seen.add(dataGrant.hasDataRegistration)
    const shapeTree = await saiSession.factory.readable.shapeTree(
      dataGrant.registeredShapeTree,
      descriptionsLang
    )
    registrations.push(
      DataRegistration.make({
        id: IRI.make(dataGrant.hasDataRegistration),
        shapeTree: dataGrant.registeredShapeTree,
        dataRegistry: registryIri,
        label: shapeTree.descriptions[descriptionsLang]?.label,
      })
    )
  }
  return DataRegistry.make({
    id: IRI.make(registryIri),
    label: dataGrants[0].hasStorage,
    registrations,
  })
}

async function findDataGrantIndex(
  saiSession: AuthorizationAgent,
  agentId: string
): Promise<Record<string, DataGrant[]>> {
  const dataGrantIndex: Record<string, DataGrant[]> = {}
  for await (const registration of saiSession.socialAgentRegistrations) {
    if (!registration.reciprocalRegistration?.accessGrant) continue
    for (const dataGrant of registration.reciprocalRegistration.accessGrant.hasDataGrant) {
      if (dataGrant.dataOwner !== agentId) continue
      if (!dataGrantIndex[dataGrant.dataRegistryIri]) {
        dataGrantIndex[dataGrant.dataRegistryIri] = []
      }
      dataGrantIndex[dataGrant.dataRegistryIri].push(dataGrant)
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
  let dataGrantIndex: Record<string, DataGrant[]>
  if (socialAgentRegistration?.reciprocalRegistration?.accessGrant) {
    dataGrantIndex = socialAgentRegistration.reciprocalRegistration.accessGrant.hasDataGrant.reduce(
      (acc, dataGrant) => {
        if (!acc[dataGrant.dataRegistryIri]) {
          acc[dataGrant.dataRegistryIri] = [] as DataGrant[]
        }
        acc[dataGrant.dataRegistryIri].push(dataGrant)
        return acc
      },
      {} as Record<string, DataGrant[]>
    )
  } else {
    dataGrantIndex = await findDataGrantIndex(saiSession, agentId)
  }
  if (!Object.keys(dataGrantIndex).length) {
    throw new Error(`missing social agent registration: ${agentId}`)
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
  registrationId: string
) => {
  const dataInstances = []
  if (agentId === saiSession.webId) {
    const dataRegistration = await saiSession.factory.readable.dataRegistration(registrationId)
    for (const dataInstanceIri of dataRegistration.contains) {
      const dataInstance = await saiSession.factory.readable.dataInstance(dataInstanceIri)
      dataInstances.push(
        DataInstance.make({
          id: IRI.make(dataInstance.iri),
          label: dataInstance.label,
        })
      )
    }
  } else {
    const socialAgentRegistration = await saiSession.findSocialAgentRegistration(agentId)
    let dataGrants: DataGrant[]
    if (socialAgentRegistration?.reciprocalRegistration?.accessGrant) {
      dataGrants = socialAgentRegistration.reciprocalRegistration.accessGrant.hasDataGrant
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

        for await (const instance of dataGrant.getDataInstanceIterator()) {
          if (seenInstances.has(instance.iri)) continue
          seenInstances.add(instance.iri)
          const dataInstance = await saiSession.factory.readable.dataInstance(instance.iri)
          dataInstances.push(
            DataInstance.make({
              id: IRI.make(dataInstance.iri),
              label: dataInstance.label,
            })
          )
        }
      }
    }
  }

  return dataInstances
}
