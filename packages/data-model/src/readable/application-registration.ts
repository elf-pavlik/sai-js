import { INTEROP } from '@janeirodigital/interop-utils'
import { Mixin } from 'ts-mixer'
import { type DataGrant, ReadableContainer } from '.'
import type { InteropFactory } from '..'
import { AgentRegistrationGetters } from '../mixins/agent-registration-getters'

export class ReadableApplicationRegistration extends Mixin(
  ReadableContainer,
  AgentRegistrationGetters
) {
  async getDataGrants(): Promise<DataGrant[]> {
    const grantIris = this.getObjectsArray(INTEROP.hasDataGrant).map((node) => node.value)
    return Promise.all(grantIris.map((iri) => this.factory.readable.dataGrant(iri)))
  }

  get granted(): boolean {
    return this.getObjectsArray(INTEROP.hasDataGrant).length > 0
  }

  private async bootstrap(): Promise<void> {
    await this.fetchData()
  }

  public static async build(
    iri: string,
    factory: InteropFactory
  ): Promise<ReadableApplicationRegistration> {
    const instance = new ReadableApplicationRegistration(iri, factory)
    await instance.bootstrap()
    return instance
  }
}
