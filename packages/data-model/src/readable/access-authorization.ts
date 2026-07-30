import { INTEROP } from '@janeirodigital/interop-utils'
import { Memoize } from 'typescript-memoize'
import { type ReadableDataAuthorization, ReadableResource } from '.'
import type {
  AuthorizationAgentFactory,
  CRUDRegistrySet,
  GrantData,
  FinalGrantData,
} from '..'

export interface GeneratedGrants {
  sourceGrants: FinalGrantData[]
  delegatedGrants: GrantData[]
}

export class ReadableAccessAuthorization extends ReadableResource {
  declare factory: AuthorizationAgentFactory

  async bootstrap(): Promise<void> {
    await this.fetchData()
  }

  public static async build(
    iri: string,
    factory: AuthorizationAgentFactory
  ): Promise<ReadableAccessAuthorization> {
    const instance = new ReadableAccessAuthorization(iri, factory)
    await instance.bootstrap()
    return instance
  }

  // TODO change to a regular array, populate in bootstrap
  get dataAuthorizations(): AsyncIterable<ReadableDataAuthorization> {
    const { factory, hasDataAuthorization } = this
    return {
      async *[Symbol.asyncIterator]() {
        for (const iri of hasDataAuthorization) {
          yield factory.readable.dataAuthorization(iri)
        }
      },
    }
  }

  @Memoize()
  get granted(): boolean {
    return this.getObject('granted').value === 'true'
  }

  @Memoize()
  get grantedBy(): string {
    return this.getObject('grantedBy').value
  }

  @Memoize()
  get grantee(): string {
    return this.getObject('grantee').value
  }

  @Memoize()
  get hasAccessNeedGroup(): string | undefined {
    return this.getObject('hasAccessNeedGroup')?.value
  }

  @Memoize()
  get hasDataAuthorization(): string[] {
    return this.getObjectsArray(INTEROP.hasDataAuthorization).map((object) => object.value)
  }

  public async generateDataGrants(
    registrySet: CRUDRegistrySet,
    grantee: string
  ): Promise<GeneratedGrants> {
    const sourceGrants: FinalGrantData[] = []
    const delegatedGrants: GrantData[] = []

    if (this.granted) {
      const regularAuthorizations: ReadableDataAuthorization[] = []
      for await (const dataAuthorization of this.dataAuthorizations) {
        if (dataAuthorization.scopeOfAuthorization !== INTEROP.Inherited.value) {
          regularAuthorizations.push(dataAuthorization)
        }
      }
      for (const dataAuthorization of regularAuthorizations) {
        const grants = await dataAuthorization.generateDataGrants(registrySet, grantee)
        sourceGrants.push(...grants.source)
        delegatedGrants.push(...grants.delegated)
      }
    }

    return {
      sourceGrants,
      delegatedGrants,
    }
  }
}
