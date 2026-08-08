import { ACL, INTEROP } from '@janeirodigital/interop-utils'
import { describe, test } from 'vitest'
import { DataAuthorization } from '../../src'
import { expect } from '../expect'
import { docFromGraphs } from './helpers'

const AUTH_IRI = 'https://registry/acme/authorization/k9m4vp'

// Graph <https://registry/acme/authorization/k9m4vp> in registry.trig:
// SelectedFromRegistry DataAuthorization with hasDataInstance, plus the child
// authorization r5j8tw pointing inheritsFromAuthorization at it (frames to
// hasInheritingAuthorization via @reverse).
describe('DataAuthorization framing', () => {
  test('frames the DataAuthorization graph into DataAuthorizationData', async () => {
    const doc = await docFromGraphs([AUTH_IRI])
    const data = await DataAuthorization.fromJsonLd(doc, AUTH_IRI)
    expect(data).toEqual({
      id: AUTH_IRI,
      type: [INTEROP.DataAuthorization.value],
      grantee: 'https://id/alice',
      grantedBy: 'https://id/acme',
      registeredShapeTree: 'https://data/shapetrees/trees/Project',
      scopeOfAuthorization: INTEROP.SelectedFromRegistry.value,
      dataOwner: 'https://id/acme',
      hasDataRegistration: 'https://data/acme-rnd/reb39k/',
      satisfiesAccessNeed: undefined,
      inheritsFromAuthorization: undefined,
      accessMode: [ACL.Read.value, ACL.Create.value, ACL.Update.value, ACL.Delete.value],
      creatorAccessMode: [],
      hasDataInstance: ['https://data/acme-rnd/reb39k/pbh2yw'],
      hasInheritingAuthorization: ['https://registry/acme/authorization/r5j8tw'],
    })
  })
})
