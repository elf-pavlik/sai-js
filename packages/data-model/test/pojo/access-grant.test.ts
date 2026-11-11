import {
  ACCESS_ACTIONS,
  INTEROP,
  LWS,
  ODRL,
  RDF,
  frameNode,
  toStore,
} from '@janeirodigital/interop-utils'
import { DataFactory } from 'n3'
import { describe, test } from 'vitest'

import {
  type FinalGrantData,
  Grant,
  type GrantTargetInput,
  grantAccess,
  grantContext,
  lwsGrantContext,
} from '../../src'
import { expect } from '../expect'

const snippetIri = 'https://some.iri/'
const GRANTEE = 'https://id/bob'
const STORAGE = 'https://pro.alice.example/'
const REGISTRATION = 'https://pro.alice.example/123'
const SHAPE_TREE = 'https://solidshapes.example/tree/Project'
const DATA_OWNER = 'https://alice.example/#id'

function targetInput(
  scopeOfGrant: string,
  extra: Partial<GrantTargetInput> = {}
): GrantTargetInput {
  return {
    scopeOfGrant,
    storage: STORAGE,
    hasDataRegistration: REGISTRATION,
    ...extra,
  }
}

function grantData(
  scopeOfGrant: string,
  extra: Partial<FinalGrantData> = {},
  targetExtra: Partial<GrantTargetInput> = {}
): FinalGrantData {
  return {
    id: snippetIri,
    type: [LWS.AccessGrant],
    storage: STORAGE,
    access: grantAccess({
      ...targetInput(scopeOfGrant, targetExtra),
      assignee: GRANTEE,
      actions: [ACCESS_ACTIONS.read],
    }),
    grantedBy: DATA_OWNER,
    dataOwner: DATA_OWNER,
    registeredShapeTree: SHAPE_TREE,
    hasDataRegistration: REGISTRATION,
    scopeOfGrant,
    ...extra,
  }
}

const commonQuads = [
  DataFactory.quad(DataFactory.namedNode(snippetIri), RDF.terms.type, LWS.terms.AccessGrant),
  DataFactory.quad(
    DataFactory.namedNode(snippetIri),
    INTEROP.terms.dataOwner,
    DataFactory.namedNode(DATA_OWNER)
  ),
  DataFactory.quad(
    DataFactory.namedNode(snippetIri),
    INTEROP.terms.registeredShapeTree,
    DataFactory.namedNode(SHAPE_TREE)
  ),
  DataFactory.quad(
    DataFactory.namedNode(snippetIri),
    INTEROP.terms.hasDataRegistration,
    DataFactory.namedNode(REGISTRATION)
  ),
]

async function toJsonLdAndCheck(data: FinalGrantData, expectedQuads: any[]) {
  const dataset = await toStore(Grant.toJsonLd(data), snippetIri)
  expect(dataset).toBeRdfDatasetContaining(...expectedQuads)
}

describe('toJsonLd', () => {
  test('should set dataset for AllFromRegistry scope', async () => {
    const grant = grantData(INTEROP.AllFromRegistry)
    const expected = [
      DataFactory.quad(
        DataFactory.namedNode(snippetIri),
        INTEROP.terms.scopeOfGrant,
        INTEROP.terms.AllFromRegistry
      ),
      ...commonQuads,
    ]
    await toJsonLdAndCheck(grant, expected)
  })

  test('should set dataset for SelectedFromRegistry scope', async () => {
    const instances = ['https://some.iri/a', 'https://some.iri/b']
    const grant = grantData(
      INTEROP.SelectedFromRegistry,
      { hasDataInstance: instances },
      { hasDataInstance: instances }
    )
    const expected = [
      DataFactory.quad(
        DataFactory.namedNode(snippetIri),
        INTEROP.terms.scopeOfGrant,
        INTEROP.terms.SelectedFromRegistry
      ),
      ...instances.map((instance) =>
        DataFactory.quad(
          DataFactory.namedNode(snippetIri),
          INTEROP.terms.hasDataInstance,
          DataFactory.namedNode(instance)
        )
      ),
      ...commonQuads,
    ]
    await toJsonLdAndCheck(grant, expected)
  })

  test('should set dataset for Inherited scope', async () => {
    const parent = 'https://some.iri/gr'
    const grant = grantData(INTEROP.Inherited, { inheritsFromGrant: parent })
    const expected = [
      DataFactory.quad(
        DataFactory.namedNode(snippetIri),
        INTEROP.terms.scopeOfGrant,
        INTEROP.terms.Inherited
      ),
      DataFactory.quad(
        DataFactory.namedNode(snippetIri),
        INTEROP.terms.inheritsFromGrant,
        DataFactory.namedNode(parent)
      ),
      ...commonQuads,
    ]
    await toJsonLdAndCheck(grant, expected)
  })
})

describe('LWS AccessGrant shape (step 3)', () => {
  test('writes only the canonical LWS shape plus SAI extensions', async () => {
    const grant = grantData(INTEROP.AllFromRegistry)
    const store = await toStore(Grant.toJsonLd(grant), snippetIri)
    const subject = DataFactory.namedNode(snippetIri)

    expect(store.getQuads(subject, RDF.terms.type, LWS.terms.AccessGrant, null)).toHaveLength(1)
    // legacy flat fields are gone
    expect(store.getQuads(subject, INTEROP.terms.grantee, null, null)).toHaveLength(0)
    expect(store.getQuads(subject, INTEROP.terms.accessMode, null, null)).toHaveLength(0)
    expect(store.getQuads(subject, INTEROP.terms.hasStorage, null, null)).toHaveLength(0)

    expect(store.getQuads(subject, LWS.terms.storage, null, null)[0].object.value).toBe(STORAGE)
    const policy = store.getQuads(subject, LWS.terms.access, null, null)[0].object
    expect(store.getQuads(policy, RDF.terms.type, LWS.terms.AccessPolicy, null)).toHaveLength(1)
    expect(store.getQuads(policy, ODRL.terms.assignee, null, null)[0].object).toEqual(
      DataFactory.namedNode(GRANTEE)
    )
    expect(store.getQuads(policy, ODRL.terms.action, null, null)[0].object.value).toBe(
      ACCESS_ACTIONS.read
    )
    const target = store.getQuads(policy, ODRL.terms.target, null, null)[0].object
    expect(store.getQuads(target, RDF.terms.type, LWS.terms.Container, null)).toHaveLength(1)
    expect(store.getQuads(target, LWS.terms.value, null, null)[0].object.value).toBe(REGISTRATION)
  })

  test('maps every SAI scope to the closest LWS target', async () => {
    const cases = [
      {
        scope: INTEROP.AllFromAgent,
        extra: {},
        targetExtra: {},
        type: LWS.StorageResource,
        values: [STORAGE],
      },
      {
        scope: INTEROP.AllFromRegistry,
        extra: {},
        targetExtra: {},
        type: LWS.Container,
        values: [REGISTRATION],
      },
      {
        scope: INTEROP.SelectedFromRegistry,
        extra: { hasDataInstance: ['https://pro.alice.example/p1'] },
        targetExtra: { hasDataInstance: ['https://pro.alice.example/p1'] },
        type: LWS.DataResource,
        values: ['https://pro.alice.example/p1'],
      },
      {
        scope: INTEROP.Inherited,
        extra: { inheritsFromGrant: 'https://some.iri/parent' },
        targetExtra: {},
        type: LWS.Container,
        values: [REGISTRATION],
      },
    ]
    for (const item of cases) {
      const grant = grantData(item.scope, item.extra, item.targetExtra)
      const store = await toStore(Grant.toJsonLd(grant), snippetIri)
      const policy = store.getQuads(
        DataFactory.namedNode(snippetIri),
        LWS.terms.access,
        null,
        null
      )[0].object
      const target = store.getQuads(policy, ODRL.terms.target, null, null)[0].object
      expect(store.getQuads(target, RDF.terms.type, item.type, null)).toHaveLength(1)
      expect(
        store
          .getQuads(target, LWS.terms.value, null, null)
          .map((quad) => quad.object.value)
          .toSorted()
      ).toEqual([...item.values].toSorted())
    }
  })

  test('frames back through the canonical reader', async () => {
    const grant = grantData(INTEROP.AllFromRegistry)
    const roundTripped = await Grant.fromJsonLd(Grant.toJsonLd(grant), snippetIri)
    expect(roundTripped.access).toEqual(grant.access)
    expect(roundTripped.storage).toBe(STORAGE)
    expect(roundTripped.type).toEqual([LWS.AccessGrant])
  })

  test('frames back to the compact LWS grant shape', async () => {
    const grant = grantData(INTEROP.AllFromRegistry)
    const framed = await frameNode(Grant.toJsonLd(grant), lwsGrantContext, snippetIri, {
      access: { '@embed': '@always' },
    })
    expect(framed.type).toEqual(['AccessGrant'])
    expect(framed.storage).toBe(STORAGE)
    expect(framed.access).toEqual([
      {
        type: ['AccessPolicy'],
        assignee: GRANTEE,
        action: [ACCESS_ACTIONS.read],
        target: { type: 'Container', value: [REGISTRATION] },
      },
    ])
  })

  test('the internal context keeps full IRIs (no compact actions/types)', async () => {
    const grant = grantData(INTEROP.AllFromRegistry)
    const framed = await frameNode(Grant.toJsonLd(grant), grantContext, snippetIri, {
      access: { '@embed': '@always' },
    })
    expect(framed.access).toEqual([
      {
        type: [LWS.AccessPolicy],
        assignee: GRANTEE,
        action: [ACCESS_ACTIONS.read],
        target: { type: LWS.Container, value: [REGISTRATION] },
      },
    ])
  })
})
