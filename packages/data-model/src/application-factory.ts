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

/**
 * The application-side factory. Creates POJOs (data structures) only —
 * reads load from the wire via the shared `loadX(iri, fetch)` modules;
 * nothing here ever writes. `AuthorizationAgentFactory` extends it with
 * the authorization-agent structures.
 */
export class ApplicationFactory {
  fetch: WhatwgFetch

  randomUUID: () => string

  constructor(dependencies: FactoryDependencies) {
    this.fetch = dependencies.fetch
    this.randomUUID = dependencies.randomUUID
  }

  dataInstance = async (
    iri: string,
    shapeTreeIri?: string,
    descriptionLang?: string
  ): Promise<DataInstanceData> => {
    let dataRegistration: DataRegistrationData | undefined
    let resolvedShapeTreeIri = shapeTreeIri
    if (!resolvedShapeTreeIri) {
      const dataRegistrationIri = `${iri.split('/').slice(0, -1).join('/')}/`
      dataRegistration = await this.dataRegistration(dataRegistrationIri)
      resolvedShapeTreeIri = dataRegistration.registeredShapeTree
    }
    const shapeTree = await this.shapeTree(resolvedShapeTreeIri)
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
            this,
            shapeTree,
            await discoverDescriptionResource(iri, this.fetch)
          )
        : await frameDataInstance(iri, this, shapeTree)
      data.label = labelFromNode(node)
      data.children = await computeChildren(node, shapeTree, this, descriptionLang)
    }
    return data
  }

  applicationRegistration = async (iri: string): Promise<ApplicationRegistrationData> =>
    loadApplicationRegistration(iri, this.fetch)

  dataRegistration = async (iri: string): Promise<DataRegistrationData> =>
    loadDataRegistration(iri, this.fetch)

  shapeTree = async (iri: string, _descriptionLang?: string): Promise<ShapeTreeData> => {
    const response = await this.fetch(iri, {
      headers: { Accept: 'application/ld+json' },
    })
    const doc = await response.json()
    return shapeTreeFromJsonLd(doc, iri)
  }

  shapeTreeDescription = async (iri: string): Promise<ShapeTreeDescriptionData> =>
    loadShapeTreeDescription(iri, this.fetch)

  webIdProfile = async (iri: string): Promise<WebIdProfileData> =>
    loadWebIdProfile(iri, this.fetch)

  clientIdDocument = async (iri: string): Promise<ClientIdDocumentData> =>
    loadClientIdDocument(iri, this.fetch)

  dataGrant(iri: string): Promise<GrantData> {
    return loadGrant(iri, this.fetch)
  }
}
