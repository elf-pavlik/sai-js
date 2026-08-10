import { ACL, INTEROP } from '@janeirodigital/interop-utils'
import { describe, test } from 'vitest'
import { Grant } from '../../src'
import { expect } from '../expect'
import { docFromGraphs } from './helpers'

const GRANT_IRI = 'https://registry/acme/grant/p9m2vr'

// Graph <https://registry/acme/grant/p9m2vr> in registry.trig:
// AllFromRegistry DataGrant, plus the child grant hdaymz pointing
// inheritsFromGrant at it (frames to hasInheritingGrant via @reverse).
describe('Grant framing', () => {
  test('frames the DataGrant graph into GrantData', async () => {
    const doc = await docFromGraphs([GRANT_IRI])
    const grant = await Grant.fromJsonLd(doc, GRANT_IRI)
    expect(grant).toEqual({
      id: GRANT_IRI,
      type: [INTEROP.DataGrant],
      grantee: 'https://id/bob',
      grantedBy: 'https://id/acme',
      dataOwner: 'https://id/acme',
      registeredShapeTree: 'https://data/shapetrees/trees/Project',
      hasDataRegistration: 'https://data/acme-rnd/reb39k/',
      hasStorage: 'https://data/acme-rnd/',
      scopeOfGrant: INTEROP.AllFromRegistry,
      accessMode: [ACL.Read, ACL.Create, ACL.Update, ACL.Delete],
      creatorAccessMode: [],
      hasDataInstance: [],
      inheritsFromGrant: undefined,
      delegationOfGrant: undefined,
      hasInheritingGrant: ['https://registry/acme/grant/hdaymz'],
    })
  })
})
