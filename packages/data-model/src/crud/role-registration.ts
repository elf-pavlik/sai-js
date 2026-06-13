import { INTEROP, RDF, SKOS } from '@janeirodigital/interop-utils'
import { DataFactory } from 'n3'
import { type CRUDData, CRUDResource } from '.'
import type { AuthorizationAgentFactory } from '..'

export class CRUDRoleRegistration extends CRUDResource {
  declare factory: AuthorizationAgentFactory

  async bootstrap(): Promise<void> {
    if (!this.data) {
      await this.fetchData()
    } else {
      this.dataset.add(DataFactory.quad(this.node, RDF.type, INTEROP.RoleRegistration))
    }
  }

  public static async build(
    iri: string,
    factory: AuthorizationAgentFactory,
    data?: CRUDData
  ): Promise<CRUDRoleRegistration> {
    const instance = new CRUDRoleRegistration(iri, factory, data)
    await instance.bootstrap()
    return instance
  }

  get label(): string {
    return this.getObject(SKOS.prefLabel)!.value
  }

  get members(): string[] {
    return this.getObjectsArray(INTEROP.hasMember).map((object) => object.value)
  }
}
