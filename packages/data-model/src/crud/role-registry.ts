import { INTEROP, LDP, RDF } from '@janeirodigital/interop-utils'
import { DataFactory } from 'n3'
import { type CRUDRoleRegistration, CRUDContainer } from '.'
import type { AuthorizationAgentFactory } from '..'
import type { CRUDData } from './resource'

export class CRUDRoleRegistry extends CRUDContainer {
  declare factory: AuthorizationAgentFactory

  async bootstrap(): Promise<void> {
    await this.fetchData()
    if (this.data) {
      this.dataset.add(DataFactory.quad(this.node, RDF.type, INTEROP.RoleRegistry))
    }
  }

  public static async build(
    iri: string,
    factory: AuthorizationAgentFactory,
    data?: CRUDData
  ): Promise<CRUDRoleRegistry> {
    const instance = new CRUDRoleRegistry(iri, factory, data)
    await instance.bootstrap()
    return instance
  }

  get roleRegistrations(): AsyncIterable<CRUDRoleRegistration> {
    const iris = this.getObjectsArray(LDP.contains).map((object) => object.value)
    const { factory } = this
    return {
      async *[Symbol.asyncIterator]() {
        for (const iri of iris) {
          yield factory.crud.roleRegistration(iri)
        }
      },
    }
  }
}
