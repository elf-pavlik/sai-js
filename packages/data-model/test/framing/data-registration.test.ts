import { INTEROP, LDP } from '@janeirodigital/interop-utils'
import { describe, test } from 'vitest'
import { DataRegistration } from '../../src'
import { expect } from '../expect'
import { docFromGraphs } from './helpers'

const REGISTRATION_IRI = 'https://data/acme-rnd/reb39k/'

// DataRegistration in registry.trig is split like CSS stores containers:
// the meta graph carries type + registeredShapeTree, the resource graph the
// LDP containment. Both graphs together form the registration document; the
// fixture lists the containment in two GRAPH blocks (same graph name) which
// merge per TriG semantics — pbh2yw and z8w2pl are both contained.
describe('DataRegistration framing', () => {
  test('frames the registration graphs into DataRegistrationData', async () => {
    const doc = await docFromGraphs([`meta:${REGISTRATION_IRI}`, REGISTRATION_IRI])
    const data = await DataRegistration.fromJsonLd(doc, REGISTRATION_IRI)
    expect(data).toEqual({
      id: REGISTRATION_IRI,
      type: [INTEROP.DataRegistration, LDP.Resource],
      registeredShapeTree: 'https://data/shapetrees/trees/Project',
      contains: ['https://data/acme-rnd/reb39k/pbh2yw', 'https://data/acme-rnd/reb39k/z8w2pl'],
    })
  })
})
