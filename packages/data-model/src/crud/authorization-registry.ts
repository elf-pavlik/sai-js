import { INTEROP, RDF } from '@janeirodigital/interop-utils'
import { DataFactory } from 'n3'
import { CRUDContainer } from '.'
import type { AuthorizationAgentFactory, DataAuthorizationData } from '..'
import type { CRUDData } from './resource'

export class CRUDAuthorizationRegistry extends CRUDContainer {
  declare factory: AuthorizationAgentFactory

  async bootstrap(): Promise<void> {
    await this.fetchData()
    if (this.data) {
      this.dataset.add(DataFactory.quad(this.node, RDF.type, INTEROP.AuthorizationRegistry))
    }
  }

  public static async build(
    iri: string,
    factory: AuthorizationAgentFactory,
    data?: CRUDData
  ): Promise<CRUDAuthorizationRegistry> {
    const instance = new CRUDAuthorizationRegistry(iri, factory, data)
    await instance.bootstrap()
    return instance
  }

  public dataAuthorizations(): AsyncIterable<DataAuthorizationData> {
    const { factory } = this
    const iris = getDataAuthorizationIris(this)
    return {
      async *[Symbol.asyncIterator]() {
        for (const iri of iris) {
          yield factory.readable.dataAuthorization(iri)
        }
      },
    }
  }

  public async findDataAuthorizations(grantee: string): Promise<DataAuthorizationData[]> {
    const matching: DataAuthorizationData[] = []
    for await (const dataAuthorization of this.dataAuthorizations()) {
      if (dataAuthorization.grantee === grantee) {
        matching.push(dataAuthorization)
      }
    }
    return matching
  }

  public async findAuthorizationsDelegatingFromOwner(
    dataOwner: string,
    roleId: string
  ): Promise<DataAuthorizationData[]> {
    const matching: DataAuthorizationData[] = []
    for await (const dataAuthorization of this.dataAuthorizations()) {
      let matches = false
      // exclude authorizations where dataOwner is also the grantee (it would match when All scope)
      if (dataAuthorization.grantee !== dataOwner) {
        if (dataAuthorization.dataOwner === dataOwner) {
          matches = true
        }
        if (!roleId && dataAuthorization.scopeOfAuthorization === INTEROP.All.value) {
          matches = true
        }
      }
      if (matches) {
        matching.push(dataAuthorization)
      }
    }
    return matching
  }
}

// ---------------------------------------------------------------------------
// Standalone functional helpers for managing hasDataAuthorization on the registry
// ---------------------------------------------------------------------------

export function getDataAuthorizationIris(registry: CRUDAuthorizationRegistry): string[] {
  return registry.getObjectsArray(INTEROP.hasDataAuthorization).map((node) => node.value)
}

export function getGranted(registry: CRUDAuthorizationRegistry): boolean {
  return getDataAuthorizationIris(registry).length > 0
}

export async function getDataAuthorizations(
  registry: CRUDAuthorizationRegistry
): Promise<DataAuthorizationData[]> {
  const iris = getDataAuthorizationIris(registry)
  return Promise.all(iris.map((iri) => registry.factory.readable.dataAuthorization(iri)))
}

export async function addDataAuthorization(
  registry: CRUDAuthorizationRegistry,
  iri: string
): Promise<void> {
  const quad = DataFactory.quad(
    DataFactory.namedNode(registry.iri),
    INTEROP.hasDataAuthorization,
    DataFactory.namedNode(iri)
  )
  await registry.addStatement(quad)
}

export async function removeDataAuthorization(
  registry: CRUDAuthorizationRegistry,
  iri: string
): Promise<void> {
  const quad = registry.getQuad(
    DataFactory.namedNode(registry.iri),
    INTEROP.hasDataAuthorization,
    DataFactory.namedNode(iri)
  )
  if (quad) {
    await registry.removeStatement(quad)
  }
}

export async function removeAllDataAuthorizations(
  registry: CRUDAuthorizationRegistry
): Promise<void> {
  const iris = getDataAuthorizationIris(registry)
  await Promise.all(iris.map((iri) => removeDataAuthorization(registry, iri)))
}
