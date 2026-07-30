import { INTEROP } from '@janeirodigital/interop-utils'
import type { GrantData, BaseFactory } from '.'
import { DataInstance } from './data-instance'
import * as Grant from './grant'

export class ReadableDataRegistrationProxy {
  constructor(public grant: GrantData, public factory: BaseFactory) {}

  public get iri(): string {
    return this.grant.hasDataRegistration
  }

  public get dataInstances(): AsyncIterable<DataInstance> {
    return Grant.getDataInstanceIterator(this.grant, this.factory)
  }

  public async newDataInstance(parent?: DataInstance): Promise<DataInstance> {
    if (this.grant.scopeOfGrant === INTEROP.SelectedFromRegistry.value) {
      throw new Error('cannot create instances based on SelectedFromRegistry data grant')
    }
    if (!parent && this.grant.scopeOfGrant === INTEROP.Inherited.value) {
      throw new Error('cannot create instances based on Inherited data grant without parent')
    }
    return Grant.newDataInstance(this.grant, this.factory, this.factory.randomUUID, parent)
  }
}
