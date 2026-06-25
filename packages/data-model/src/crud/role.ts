import { INTEROP, RDF, SKOS } from '@janeirodigital/interop-utils'
import { DataFactory } from 'n3'
import { type CRUDData, CRUDResource } from '.'
import type { AuthorizationAgentFactory } from '..'

export class CRUDRole extends CRUDResource {
  declare factory: AuthorizationAgentFactory

  async bootstrap(): Promise<void> {
    if (!this.data) {
      await this.fetchData()
    } else {
      this.dataset.add(DataFactory.quad(this.node, RDF.type, INTEROP.Role))
      this.datasetFromData()
    }
  }

  public static async build(
    iri: string,
    factory: AuthorizationAgentFactory,
    data?: CRUDData
  ): Promise<CRUDRole> {
    const instance = new CRUDRole(iri, factory, data)
    await instance.bootstrap()
    return instance
  }

  get label(): string {
    return this.getObject(SKOS.prefLabel)!.value
  }

  get members(): string[] {
    return this.getObjectsArray(INTEROP.hasMember).map((object) => object.value)
  }

  protected datasetFromData(): void {
    if (this.data.label) {
      this.dataset.add(
        DataFactory.quad(this.node, SKOS.prefLabel, DataFactory.literal(this.data.label as string))
      )
    }
    const members = this.data.members
    if (Array.isArray(members)) {
      for (const member of members) {
        this.dataset.add(
          DataFactory.quad(this.node, INTEROP.hasMember, DataFactory.namedNode(member))
        )
      }
    }
  }
}
