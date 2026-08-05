import { type RdfFetch } from '@janeirodigital/interop-utils'
import {
  type GrantData,
  DataInstance,
  type DataRegistrationData,
  type ApplicationRegistrationData,
  type FactoryDependencies,
  fromJsonLd,
  type DataInstanceData,
  type ShapeTreeData,
  type ClientIdDocumentData,
  type ShapeTreeDescriptionData,
  type WebIdProfileData,
} from '.'
import { fromJsonLd as clientIdDocumentFromJsonLd } from './client-id-document'
import { fromJsonLd as dataRegistrationFromJsonLd } from './data-registration'
import { fromJsonLd as applicationRegistrationFromJsonLd } from './application-registration'
import { fromJsonLd as shapeTreeDescriptionFromJsonLd } from './shape-tree-description'
import { fromJsonLd as webIdProfileFromJsonLd } from './web-id-profile'
import { fromJsonLd as shapeTreeFromJsonLd } from './shape-tree'
import {
  computeChildren,
  computeLabel,
  discoverDescriptionResource,
  fetchDataInstanceDataset,
  isBlob,
} from './data-instance'

export interface BaseReadableFactory {
  dataInstance(
    iri: string,
    shapeTreeIri?: string,
    descriptionLang?: string
  ): Promise<DataInstanceData>
  applicationRegistration(iri: string): Promise<ApplicationRegistrationData>
  dataRegistration(iri: string): Promise<DataRegistrationData>
  shapeTree(iri: string, descriptionLang?: string): Promise<ShapeTreeData>
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
      ): Promise<DataInstanceData> {
        let dataRegistration: DataRegistrationData | undefined
        let resolvedShapeTreeIri = shapeTreeIri
        if (!resolvedShapeTreeIri) {
          const dataRegistrationIri = `${iri.split('/').slice(0, -1).join('/')}/`
          dataRegistration = await factory.readable.dataRegistration(dataRegistrationIri)
          resolvedShapeTreeIri = dataRegistration.registeredShapeTree
        }
        const shapeTree = await factory.readable.shapeTree(resolvedShapeTreeIri)
        const blob = isBlob(shapeTree)
        const data: DataInstanceData = {
          id: iri,
          shapeTreeIri: resolvedShapeTreeIri,
          isBlob: blob,
          children: [],
          dataRegistration,
        }
        if (descriptionLang) {
          const dataset = !blob
            ? await fetchDataInstanceDataset(iri, factory)
            : await fetchDataInstanceDataset(
                await discoverDescriptionResource(iri, factory.fetch),
                factory
              )
          data.label = computeLabel(dataset, iri, shapeTree)
          data.children = await computeChildren(dataset, iri, shapeTree, factory, descriptionLang)
        }
        return data
      },
      applicationRegistration: async function applicationRegistration(
        iri: string
      ): Promise<ApplicationRegistrationData> {
        const response = await factory.fetch.raw(iri, {
          headers: { Accept: 'application/ld+json' },
        })
        const doc = await response.json()
        return applicationRegistrationFromJsonLd(doc, iri)
      },
      dataRegistration: async function dataRegistration(
        iri: string
      ): Promise<DataRegistrationData> {
        const response = await factory.fetch.raw(iri, {
          headers: { Accept: 'application/ld+json' },
        })
        const doc = await response.json()
        return dataRegistrationFromJsonLd(doc, iri)
      },
      shapeTree: async function shapeTree(
        iri: string,
        _descriptionLang?: string
      ): Promise<ShapeTreeData> {
        const response = await factory.fetch.raw(iri, {
          headers: { Accept: 'application/ld+json' },
        })
        const doc = await response.json()
        return shapeTreeFromJsonLd(doc, iri)
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
