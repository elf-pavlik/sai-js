import type { AuthorizationAgent } from '@janeirodigital/interop-authorization-agent'
import type { CRUDDataRegistry, GrantData } from '@janeirodigital/interop-data-model'
import { getDataGrantIris, getDataGrants, Grant } from '@janeirodigital/interop-data-model'
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
        id: IRI.make(registration.id),
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
  dataGrants: GrantData[],
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
): Promise<Record<string, GrantData[]>> {
  const dataGrantIndex: Record<string, GrantData[]> = {}
  for await (const registration of saiSession.socialAgentRegistrations) {
    const reciprocalReg = registration.reciprocalRegistration
    if (!reciprocalReg || getDataGrantIris(reciprocalReg).length === 0) continue
    const dataGrants = await getDataGrants(reciprocalReg)
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
  let dataGrantIndex: Record<string, GrantData[]>
  if (socialAgentRegistration?.reciprocalRegistration && getDataGrantIris(socialAgentRegistration.reciprocalRegistration).length > 0) {
    const dataGrants = await getDataGrants(socialAgentRegistration.reciprocalRegistration)
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
    let dataGrants: GrantData[]
    if (socialAgentRegistration?.reciprocalRegistration && getDataGrantIris(socialAgentRegistration.reciprocalRegistration).length > 0) {
      dataGrants = await getDataGrants(socialAgentRegistration.reciprocalRegistration)
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
            dataGrant.registeredShapeTree
          )
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
