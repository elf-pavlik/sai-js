import type { WhatwgFetch } from '@janeirodigital/interop-utils'
import type {
  ApplicationRegistrationData,
  ClientIdDocumentData,
  DataInstanceData,
  DataRegistrationData,
  FactoryDependencies,
  GrantData,
  ShapeTreeData,
  ShapeTreeDescriptionData,
  WebIdProfileData,
} from '.'
import { loadApplicationRegistration } from './application-registration'
import { loadClientIdDocument } from './client-id-document'
import {
  computeChildren,
  discoverDescriptionResource,
  frameDataInstance,
  isBlob,
  labelFromNode,
} from './data-instance'
import { loadDataRegistration } from './data-registration'
import { loadGrant } from './grant'
import { fromJsonLd as shapeTreeFromJsonLd } from './shape-tree'
import { loadShapeTreeDescription } from './shape-tree-description'
import { loadWebIdProfile } from './web-id-profile'

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

  fetch: WhatwgFetch

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
          const node = blob
            ? await frameDataInstance(
                iri,
                factory,
                shapeTree,
                await discoverDescriptionResource(iri, factory.fetch)
              )
            : await frameDataInstance(iri, factory, shapeTree)
          data.label = labelFromNode(node)
          data.children = await computeChildren(node, shapeTree, factory, descriptionLang)
        }
        return data
      },
      applicationRegistration: async function applicationRegistration(
        iri: string
      ): Promise<ApplicationRegistrationData> {
        return loadApplicationRegistration(iri, factory.fetch)
      },
      dataRegistration: async function dataRegistration(
        iri: string
      ): Promise<DataRegistrationData> {
        return loadDataRegistration(iri, factory.fetch)
      },
      shapeTree: async function shapeTree(
        iri: string,
        _descriptionLang?: string
      ): Promise<ShapeTreeData> {
        const response = await factory.fetch(iri, {
          headers: { Accept: 'application/ld+json' },
        })
        const doc = await response.json()
        return shapeTreeFromJsonLd(doc, iri)
      },
      shapeTreeDescription: async function shapeTreeDescription(
        iri: string
      ): Promise<ShapeTreeDescriptionData> {
        return loadShapeTreeDescription(iri, factory.fetch)
      },
      webIdProfile: async function webIdProfile(iri: string): Promise<WebIdProfileData> {
        return loadWebIdProfile(iri, factory.fetch)
      },
      clientIdDocument: async function clientIdDocument(
        iri: string
      ): Promise<ClientIdDocumentData> {
        return loadClientIdDocument(iri, factory.fetch)
      },
      dataGrant: async function dataGrant(iri: string): Promise<GrantData> {
        return loadGrant(iri, factory.fetch)
      },
    }
  }
}
