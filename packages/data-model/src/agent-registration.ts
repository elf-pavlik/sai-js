import { INTEROP } from '@janeirodigital/interop-utils'
import { DataFactory, Store } from 'n3'

export type AgentRegistrationId = {
  id: string
  type: string[]
}

export type AgentRegistrationData = AgentRegistrationId & {
  registeredAgent: string
  hasDataGrant?: string[]
}

export function toDataset(data: AgentRegistrationData): Store {
  const store = new Store()
  const node = DataFactory.namedNode(data.id)
  if (data.registeredAgent) {
    store.add(
      DataFactory.quad(
        node,
        INTEROP.terms.registeredAgent,
        DataFactory.namedNode(data.registeredAgent)
      )
    )
  }
  if (data.hasDataGrant) {
    for (const grantIri of data.hasDataGrant) {
      store.add(DataFactory.quad(node, INTEROP.terms.hasDataGrant, DataFactory.namedNode(grantIri)))
    }
  }
  return store
}

export function getDataGrantIris(data: AgentRegistrationData): string[] {
  return data.hasDataGrant ?? []
}
