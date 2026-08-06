import { type RdfFetch } from '@janeirodigital/interop-utils'
import {
  type GrantData,
  DataInstance,
  type DataRegistrationData,
  type ApplicationRegistrationData,
  type FactoryDependencies,
  type DataInstanceData,
  type ShapeTreeData,
  type ClientIdDocumentData,
  type ShapeTreeDescriptionData,
  type WebIdProfileData,
} from '.'
import { loadClientIdDocument } from './client-id-document'
import { loadDataRegistration } from './data-registration'
import { loadApplicationRegistration } from './application-registration'
import { loadGrant } from './grant'
import { loadShapeTreeDescription } from './shape-tree-description'
import { loadWebIdProfile } from './web-id-profile'
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
        return loadApplicationRegistration(iri, factory.fetch.raw)
      },
      dataRegistration: async function dataRegistration(
        iri: string
      ): Promise<DataRegistrationData> {
        return loadDataRegistration(iri, factory.fetch.raw)
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
        return loadShapeTreeDescription(iri, factory.fetch.raw)
      },
      webIdProfile: async function webIdProfile(iri: string): Promise<WebIdProfileData> {
        return loadWebIdProfile(iri, factory.fetch.raw)
      },
      clientIdDocument: async function clientIdDocument(
        iri: string
      ): Promise<ClientIdDocumentData> {
        return loadClientIdDocument(iri, factory.fetch.raw)
      },
      dataGrant: async function dataGrant(iri: string): Promise<GrantData> {
        return loadGrant(iri, factory.fetch.raw)
      },
    }
  }

  async dataInstance(iri: string, grant: GrantData, parent?: DataInstance): Promise<DataInstance> {
    return DataInstance.build(iri, grant, this, parent)
  }
}
