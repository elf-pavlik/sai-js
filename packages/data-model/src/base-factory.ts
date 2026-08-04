import { type RdfFetch } from '@janeirodigital/interop-utils'
import {
  type GrantData,
  DataInstance,
  type FactoryDependencies,
  fromJsonLd,
  ReadableApplicationRegistration,
  ReadableDataInstance,
  ReadableDataRegistration,
  ReadableShapeTree,
  type ClientIdDocumentData,
  type ShapeTreeDescriptionData,
  type WebIdProfileData,
} from '.'
import { fromJsonLd as clientIdDocumentFromJsonLd } from './client-id-document'
import { fromJsonLd as shapeTreeDescriptionFromJsonLd } from './shape-tree-description'
import { fromJsonLd as webIdProfileFromJsonLd } from './web-id-profile'

export interface BaseReadableFactory {
  dataInstance(iri: string, shapeTreeIri?: string, descriptionLang?: string): Promise<ReadableDataInstance>
  applicationRegistration(iri: string): Promise<ReadableApplicationRegistration>
  dataRegistration(iri: string): Promise<ReadableDataRegistration>
  shapeTree(iri: string, descriptionLang?: string): Promise<ReadableShapeTree>
  shapeTreeDescription(iri: string): Promise<ShapeTreeDescriptionData>
  dataGrant(iri: string): Promise<GrantData>
  webIdProfile(iri: string): Promise<WebIdProfileData>
  clientIdDocument(iri: string): Promise<ClientIdDocumentData>
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
      shapeTreeDescription: async function shapeTreeDescription(
        iri: string
      ): Promise<ShapeTreeDescriptionData> {
        const response = await factory.fetch.raw(iri, {
          headers: { Accept: 'application/ld+json' },
        })
        const doc = await response.json()
        return shapeTreeDescriptionFromJsonLd(doc, iri)
      },
      webIdProfile: async function webIdProfile(iri: string): Promise<WebIdProfileData> {
        const response = await factory.fetch.raw(iri, {
          headers: { Accept: 'application/ld+json' },
        })
        const doc = await response.json()
        return webIdProfileFromJsonLd(doc, iri)
      },
      clientIdDocument: async function clientIdDocument(
        iri: string
      ): Promise<ClientIdDocumentData> {
        const response = await factory.fetch.raw(iri, {
          headers: { Accept: 'application/ld+json' },
        })
        const doc = await response.json()
        return clientIdDocumentFromJsonLd(doc, iri)
      },
      dataGrant: async function dataGrant(iri: string): Promise<GrantData> {
        const response = await factory.fetch.raw(iri, {
          headers: { Accept: 'application/ld+json' },
        })
        const doc = await response.json()
        return fromJsonLd(doc, iri)
      },
    }
  }

  async dataInstance(iri: string, grant: GrantData, parent?: DataInstance): Promise<DataInstance> {
    return DataInstance.build(iri, grant, this, parent)
  }
}
