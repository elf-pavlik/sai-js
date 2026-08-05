import { INTEROP, RDF } from '@janeirodigital/interop-utils'
import { DataFactory } from 'n3'
import { CRUDContainer } from '.'
import type { AuthorizationAgentFactory } from '..'
import type { DataRegistrationData } from '../data-registration'

export class CRUDDataRegistration extends CRUDContainer {
  declare data: DataRegistrationData

  public static async build(
    iri: string,
    factory: AuthorizationAgentFactory,
    data?: DataRegistrationData
  ): Promise<CRUDDataRegistration> {
    const instance = new CRUDDataRegistration(iri, factory, data)
    await instance.bootstrap()
    return instance
  }

  private datasetFromData(): void {
    const props = ['registeredShapeTree'] as const
    for (const prop of props) {
      this.dataset.add(
        DataFactory.quad(
          DataFactory.namedNode(this.iri),
          INTEROP[prop],
          DataFactory.namedNode(this.data[prop])
        )
      )
    }
  }

  protected async bootstrap(): Promise<void> {
    if (!this.data) {
      await this.fetchData()
    } else {
      this.dataset.add(DataFactory.quad(this.node, RDF.type, INTEROP.DataRegistration))
      this.datasetFromData()
    }
  }
}
