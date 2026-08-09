import { randomUUID } from 'node:crypto'
import { fetch } from '@janeirodigital/interop-test-utils'
import { ACL, INTEROP, RDF, toStore } from '@janeirodigital/interop-utils'
import { DataFactory } from 'n3'
import { describe, test } from 'vitest'
import { DataAuthorization, type FinalDataAuthorizationData } from '../../src'
import { expect } from '../expect'

const webId = 'https://alice.example/#id'
const snippetIri = 'https://some.iri/'
const commonData = {
  type: [INTEROP.DataAuthorization.value],
  grantee: 'https://projectron.example/#app',
  grantedBy: webId,
  registeredShapeTree: 'https://solidshapes.example/tree/Project',
  hasDataRegistration: 'https://pro.alice.example/123',
  accessMode: [ACL.Read.value],
}
const commonQuads = [
  DataFactory.quad(DataFactory.namedNode(snippetIri), RDF.type, INTEROP.DataAuthorization),
  DataFactory.quad(
    DataFactory.namedNode(snippetIri),
    INTEROP.grantee,
    DataFactory.namedNode(commonData.grantee)
  ),
  DataFactory.quad(
    DataFactory.namedNode(snippetIri),
    INTEROP.grantedBy,
    DataFactory.namedNode(commonData.grantedBy)
  ),
  DataFactory.quad(
    DataFactory.namedNode(snippetIri),
    INTEROP.registeredShapeTree,
    DataFactory.namedNode(commonData.registeredShapeTree)
  ),
  DataFactory.quad(
    DataFactory.namedNode(snippetIri),
    INTEROP.hasDataRegistration,
    DataFactory.namedNode(commonData.hasDataRegistration)
  ),
  DataFactory.quad(DataFactory.namedNode(snippetIri), INTEROP.accessMode, ACL.Read),
]

async function toJsonLdAndCheck(
  data: Omit<FinalDataAuthorizationData, 'id'>,
  expectedQuads: any[]
) {
  const finalData: FinalDataAuthorizationData = { id: snippetIri, ...data }
  const dataset = await toStore(DataAuthorization.toJsonLd(finalData), snippetIri)
  expect(dataset).toBeRdfDatasetContaining(...expectedQuads)
}

describe('toJsonLd', () => {
  test('should set dataset for AllFromRegistry scope', async () => {
    const allFromRegistryData = {
      dataOwner: 'https://alice.example/#id',
      scopeOfAuthorization: INTEROP.AllFromRegistry.value,
      ...commonData,
    }
    const allFromRegistryQuads = [
      DataFactory.quad(
        DataFactory.namedNode(snippetIri),
        INTEROP.dataOwner,
        DataFactory.namedNode(allFromRegistryData.dataOwner)
      ),
      DataFactory.quad(
        DataFactory.namedNode(snippetIri),
        INTEROP.scopeOfAuthorization,
        INTEROP.AllFromRegistry
      ),
      ...commonQuads,
    ]

    await toJsonLdAndCheck(allFromRegistryData, allFromRegistryQuads)
  })

  test('should set dataset for SelectedFromRegistry scope', async () => {
    const selectedFromRegistryData = {
      dataOwner: 'https://alice.example/#id',
      scopeOfAuthorization: INTEROP.SelectedFromRegistry.value,
      hasDataInstance: ['https://some.iri/a', 'https://some.iri/b'],
      ...commonData,
    }
    const selectedFromRegistryQuads = [
      DataFactory.quad(
        DataFactory.namedNode(snippetIri),
        INTEROP.dataOwner,
        DataFactory.namedNode(selectedFromRegistryData.dataOwner)
      ),
      DataFactory.quad(
        DataFactory.namedNode(snippetIri),
        INTEROP.scopeOfAuthorization,
        INTEROP.SelectedFromRegistry
      ),
      DataFactory.quad(
        DataFactory.namedNode(snippetIri),
        INTEROP.hasDataInstance,
        DataFactory.namedNode('https://some.iri/a')
      ),
      DataFactory.quad(
        DataFactory.namedNode(snippetIri),
        INTEROP.hasDataInstance,
        DataFactory.namedNode('https://some.iri/b')
      ),
      ...commonQuads,
    ]

    await toJsonLdAndCheck(selectedFromRegistryData, selectedFromRegistryQuads)
  })

  test('should set dataset for Inherited scope', async () => {
    const inheritedData = {
      dataOwner: 'https://alice.example/#id',
      scopeOfAuthorization: INTEROP.Inherited.value,
      inheritsFromAuthorization: 'https://some.iri/gr',
      ...commonData,
    }
    const inheritedQuads = [
      DataFactory.quad(
        DataFactory.namedNode(snippetIri),
        INTEROP.dataOwner,
        DataFactory.namedNode(inheritedData.dataOwner)
      ),
      DataFactory.quad(
        DataFactory.namedNode(snippetIri),
        INTEROP.scopeOfAuthorization,
        INTEROP.Inherited
      ),
      DataFactory.quad(
        DataFactory.namedNode(snippetIri),
        INTEROP.inheritsFromAuthorization,
        DataFactory.namedNode(inheritedData.inheritsFromAuthorization)
      ),
      ...commonQuads,
    ]

    await toJsonLdAndCheck(inheritedData, inheritedQuads)
  })

  test('should set dataset with creatorAccessMode', async () => {
    const allFromRegistryData = {
      dataOwner: 'https://alice.example/#id',
      scopeOfAuthorization: INTEROP.AllFromRegistry.value,
      creatorAccessMode: [ACL.Update.value],
      ...commonData,
    }
    const allFromRegistryQuads = [
      DataFactory.quad(
        DataFactory.namedNode(snippetIri),
        INTEROP.dataOwner,
        DataFactory.namedNode(allFromRegistryData.dataOwner)
      ),
      DataFactory.quad(
        DataFactory.namedNode(snippetIri),
        INTEROP.scopeOfAuthorization,
        INTEROP.AllFromRegistry
      ),
      DataFactory.quad(
        DataFactory.namedNode(snippetIri),
        INTEROP.creatorAccessMode,
        ACL.Update.value
      ),
      ...commonQuads,
    ]

    await toJsonLdAndCheck(allFromRegistryData, allFromRegistryQuads)
  })

  test('links back to children', async () => {
    const childIri = 'https://some.iri/child'

    const allFromRegistryData = {
      dataOwner: 'https://alice.example/#id',
      scopeOfAuthorization: INTEROP.AllFromRegistry.value,
      hasInheritingAuthorization: [childIri],
      ...commonData,
    }

    const finalData: FinalDataAuthorizationData = { id: snippetIri, ...allFromRegistryData }
    const dataset = await toStore(DataAuthorization.toJsonLd(finalData), snippetIri)

    const linkBackQuad = DataFactory.quad(
      DataFactory.namedNode(childIri),
      INTEROP.inheritsFromAuthorization,
      DataFactory.namedNode(snippetIri)
    )
    expect(dataset).toBeRdfDatasetContaining(linkBackQuad)
  })
})
