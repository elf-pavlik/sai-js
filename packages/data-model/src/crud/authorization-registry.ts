import { INTEROP, RDF } from '@janeirodigital/interop-utils'
import { DataFactory } from 'n3'
import { CRUDContainer } from '.'
import type { AuthorizationAgentFactory, ReadableAccessAuthorization } from '..'
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

  public async accessAuthorizations(): Promise<AsyncIterable<ReadableAccessAuthorization>> {
    await this.fetchData()
    const accessAuthorizationPattern = [
      DataFactory.namedNode(this.iri),
      INTEROP.hasAccessAuthorization,
    ]
    const accessAuthorizationIris = this.getQuadArray(...accessAuthorizationPattern).map(
      (q) => q.object.value
    )
    const { factory } = this
    return {
      async *[Symbol.asyncIterator]() {
        for (const iri of accessAuthorizationIris) {
          yield factory.readable.accessAuthorization(iri)
        }
      },
    }
  }

  async findAuthorization(agentIri: string): Promise<ReadableAccessAuthorization | undefined> {
    for await (const authorization of await this.accessAuthorizations()) {
      if (authorization.grantee === agentIri) {
        return authorization
      }
    }
  }

  /*
   * Links access authorization from registry
   * If prior authorization exists for that agent it gets unlinked
   * Updates itself
   */
  async add(accessAuthorization: ReadableAccessAuthorization): Promise<void> {
    const quad = DataFactory.quad(
      DataFactory.namedNode(this.iri),
      INTEROP.hasAccessAuthorization,
      DataFactory.namedNode(accessAuthorization.iri)
    )
    // unlink prevoius access authorization for that grantee if exists
    const priorAuthorization = await this.findAuthorization(accessAuthorization.grantee)
    if (priorAuthorization) {
      const priorQuad = this.getQuad(
        DataFactory.namedNode(this.iri),
        INTEROP.hasAccessAuthorization,
        DataFactory.namedNode(priorAuthorization.iri)
      )
      await this.replaceStatement(priorQuad, quad)
      this.removeStatement(priorQuad)
      this.addStatement(quad)
    } else {
      await this.addStatement(quad)
    }
  }

  /*
   * Unlinks access authorization from registry
   * Updates itself
   */
  async remove(accessAuthorizationIri: string): Promise<void> {
    const quad = this.getQuad(
      DataFactory.namedNode(this.iri),
      INTEROP.hasAccessAuthorization,
      DataFactory.namedNode(accessAuthorizationIri)
    )
    await this.removeStatement(quad)
    this.removeStatement(quad)
  }
  async findAuthorizationsDelegatingFromOwner(
    dataOwner: string,
    roleId: string
  ): Promise<ReadableAccessAuthorization[]> {
    const matching: ReadableAccessAuthorization[] = []
    for await (const accessAuthorization of await this.accessAuthorizations()) {
      let matches = false
      // exclude authorizations where dataOwner is also the grantee (it would match when All scope)
      if (accessAuthorization.grantee !== dataOwner) {
        for await (const dataAuthorization of accessAuthorization.dataAuthorizations) {
          if (dataAuthorization.dataOwner === dataOwner) {
            matches = true
          }
          if (!roleId && dataAuthorization.scopeOfAuthorization === INTEROP.All.value) {
            matches = true
          }
        }
      }
      if (matches) {
        matching.push(accessAuthorization)
      }
    }
    return matching
  }
}
