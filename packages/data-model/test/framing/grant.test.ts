import { ACCESS_ACTIONS, INTEROP, LWS } from '@janeirodigital/interop-utils'
import { describe, test } from 'vitest'

import { Grant } from '../../src'
import { expect } from '../expect'
import { docFromGraphs } from './helpers'

const GRANT_IRI = 'https://registry/acme/p9m2vr'

// Graph <https://registry/acme/p9m2vr> in registry.trig:
// AllFromRegistry AccessGrant, plus the child grant hdaymz pointing
// inheritsFromGrant at it (frames to hasInheritingGrant via @reverse).
describe('Grant framing', () => {
  test('frames the grant graph into the canonical LWS shape', async () => {
    const doc = await docFromGraphs([GRANT_IRI])
    const grant = await Grant.fromJsonLd(doc, GRANT_IRI)
    expect(grant).toEqual({
      id: GRANT_IRI,
      type: [LWS.AccessGrant],
      storage: 'https://data/acme-rnd/',
      access: [
        {
          type: [LWS.AccessPolicy],
          assignee: 'https://id/bob',
          action: [
            ACCESS_ACTIONS.read,
            ACCESS_ACTIONS.create,
            ACCESS_ACTIONS.modify,
            ACCESS_ACTIONS.delete,
          ],
          target: {
            type: LWS.Container,
            value: ['https://data/acme-rnd/reb39k'],
          },
        },
      ],
      grantedBy: 'https://id/acme',
      dataOwner: 'https://id/acme',
      registeredShapeTree: 'https://data/shapetrees/trees/Project',
      hasDataRegistration: 'https://data/acme-rnd/reb39k',
      scopeOfGrant: INTEROP.AllFromRegistry,
      inheritsFromGrant: undefined,
      hasInheritingGrant: ['https://registry/acme/hdaymz'],
    })
  })
})
