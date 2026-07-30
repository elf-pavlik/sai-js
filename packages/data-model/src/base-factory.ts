import { type RdfFetch } from '@janeirodigital/interop-utils'
import {
  type GrantData,
  DataInstance,
  type FactoryDependencies,
  fromDataset,
  ReadableApplicationRegistration,
  ReadableClientIdDocument,
  ReadableDataInstance,
  ReadableDataRegistration,
  ReadableShapeTree,
  ReadableWebIdProfile,
} from '.'

export interface BaseReadableFactory {
  dataInstance(iri: string, shapeTreeIri?: string, descriptionLang?: string): Promise<ReadableDataInstance>
  applicationRegistration(iri: string): Promise<ReadableApplicationRegistration>
  dataRegistration(iri: string): Promise<ReadableDataRegistration>
  shapeTree(iri: string, descriptionLang?: string): Promise<ReadableShapeTree>
  dataGrant(iri: string): Promise<GrantData>
  webIdProfile(iri: string): Promise<ReadableWebIdProfile>
  clientIdDocument(iri: string): Promise<ReadableClientIdDocument>
}

export class BaseFactory {
  readable: BaseReadableFactory

  fetch: RdfFetch

  randomUUID: () => string

  constructor(dependencies: FactoryDependencies) {
    this.fetch = dependencies.fetch
    this.randomUUID = dependencies.randomUUID

    this.readable = this.readableFactory()
  }

  protected readableFactory(): BaseReadableFactory {
    const factory = this
    return {
      dataInstance: async function dataInstance(
        iri: string,
        shapeTreeIri?: string,
        descriptionLang?: string
      ): Promise<ReadableDataInstance> {
        return ReadableDataInstance.build(iri, factory, shapeTreeIri, descriptionLang)
      },
      applicationRegistration: async function applicationRegistration(
        iri: string
      ): Promise<ReadableApplicationRegistration> {
        return ReadableApplicationRegistration.build(iri, factory)
      },
      dataRegistration: async function dataRegistration(
        iri: string
      ): Promise<ReadableDataRegistration> {
        return ReadableDataRegistration.build(iri, factory)
      },
      shapeTree: async function shapeTree(
        iri: string,
        descriptionLang?: string
      ): Promise<ReadableShapeTree> {
        return ReadableShapeTree.build(iri, factory, descriptionLang)
      },
      webIdProfile: async function webIdProfile(iri: string): Promise<ReadableWebIdProfile> {
        return ReadableWebIdProfile.build(iri, factory)
      },
      clientIdDocument: async function clientIdDocument(
        iri: string
      ): Promise<ReadableClientIdDocument> {
        return ReadableClientIdDocument.build(iri, factory)
      },
      dataGrant: async function dataGrant(iri: string): Promise<GrantData> {
        const response = await factory.fetch(iri)
        const dataset = await response.dataset()
        return fromDataset(dataset, iri)
      },
    }
  }

  async dataInstance(iri: string, grant: GrantData, parent?: DataInstance): Promise<DataInstance> {
    return DataInstance.build(iri, grant, this, parent)
  }
}
