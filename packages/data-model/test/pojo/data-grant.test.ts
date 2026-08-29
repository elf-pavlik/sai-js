import { randomUUID } from 'node:crypto'
import { fetch } from '@janeirodigital/interop-test-utils'
import { ACL, INTEROP, RDF, toStore } from '@janeirodigital/interop-utils'
import { DataFactory } from 'n3'
import { describe, test } from 'vitest'
import { type FinalGrantData, Grant } from '../../src'
import { expect } from '../expect'

const deps = { fetch, randomUUID }
const snippetIri = 'https://some.iri/'
const commonData = {
  type: [INTEROP.DataGrant],
  dataOwner: 'https://alice.example/#id',
  registeredShapeTree: 'https://solidshapes.example/tree/Project',
  hasDataRegistration: 'https://pro.alice.example/123',
  accessMode: [ACL.Read],
}
const commonQuads = [
  DataFactory.quad(DataFactory.namedNode(snippetIri), RDF.terms.type, INTEROP.terms.DataGrant),
  DataFactory.quad(
    DataFactory.namedNode(snippetIri),
    INTEROP.terms.dataOwner,
    DataFactory.namedNode(commonData.dataOwner)
  ),
  DataFactory.quad(
    DataFactory.namedNode(snippetIri),
    INTEROP.terms.registeredShapeTree,
    DataFactory.namedNode(commonData.registeredShapeTree)
  ),
  DataFactory.quad(
    DataFactory.namedNode(snippetIri),
    INTEROP.terms.hasDataRegistration,
    DataFactory.namedNode(commonData.hasDataRegistration)
  ),
  DataFactory.quad(
    DataFactory.namedNode(snippetIri),
    INTEROP.terms.accessMode,
    DataFactory.namedNode(ACL.Read)
  ),
]

async function toJsonLdAndCheck(data: Omit<FinalGrantData, 'id'>, expectedQuads: any[]) {
  const finalGrant = { id: snippetIri, ...data }
  const dataset = await toStore(Grant.toJsonLd(finalGrant), snippetIri)
  expect(dataset).toBeRdfDatasetContaining(...expectedQuads)
}

describe('toJsonLd', () => {
  test('should set dataset for AllFromRegistry scope', async () => {
    const allFromRegistryData = {
      scopeOfGrant: INTEROP.AllFromRegistry,
      ...commonData,
    }
    const allFromRegistryQuads = [
      DataFactory.quad(
        DataFactory.namedNode(snippetIri),
        INTEROP.terms.scopeOfGrant,
        INTEROP.terms.AllFromRegistry
      ),
      ...commonQuads,
    ]

    await toJsonLdAndCheck(allFromRegistryData, allFromRegistryQuads)
  })

  test('should set dataset for SelectedFromRegistry scope', async () => {
    const selectedFromRegistryData = {
      scopeOfGrant: INTEROP.SelectedFromRegistry,
      hasDataInstance: ['https://some.iri/a', 'https://some.iri/b'],
      ...commonData,
    }
    const selectedFromRegistryQuads = [
      DataFactory.quad(
        DataFactory.namedNode(snippetIri),
        INTEROP.terms.scopeOfGrant,
        INTEROP.terms.SelectedFromRegistry
      ),
      DataFactory.quad(
        DataFactory.namedNode(snippetIri),
        INTEROP.terms.hasDataInstance,
        DataFactory.namedNode('https://some.iri/a')
      ),
      DataFactory.quad(
        DataFactory.namedNode(snippetIri),
        INTEROP.terms.hasDataInstance,
        DataFactory.namedNode('https://some.iri/b')
      ),
      ...commonQuads,
    ]

    await toJsonLdAndCheck(selectedFromRegistryData, selectedFromRegistryQuads)
  })

  test('should set dataset for Inherited scope', async () => {
    const inheritedData = {
      scopeOfGrant: INTEROP.Inherited,
      inheritsFromGrant: 'https://some.iri/gr',
      ...commonData,
    }
    const inheritedQuads = [
      DataFactory.quad(
        DataFactory.namedNode(snippetIri),
        INTEROP.terms.scopeOfGrant,
        INTEROP.terms.Inherited
      ),
      DataFactory.quad(
        DataFactory.namedNode(snippetIri),
        INTEROP.terms.inheritsFromGrant,
        DataFactory.namedNode(inheritedData.inheritsFromGrant)
      ),
      ...commonQuads,
    ]

    await toJsonLdAndCheck(inheritedData, inheritedQuads)
  })

  test('should set dataset with creatorAccessMode', async () => {
    const allFromRegistryData = {
      scopeOfGrant: INTEROP.AllFromRegistry,
      creatorAccessMode: [ACL.Update],
      ...commonData,
    }
    const allFromRegistryQuads = [
      DataFactory.quad(
        DataFactory.namedNode(snippetIri),
        INTEROP.terms.scopeOfGrant,
        INTEROP.terms.AllFromRegistry
      ),
      DataFactory.quad(
        DataFactory.namedNode(snippetIri),
        INTEROP.terms.creatorAccessMode,
        ACL.terms.Update
      ),
      ...commonQuads,
    ]

    await toJsonLdAndCheck(allFromRegistryData, allFromRegistryQuads)
  })
})
