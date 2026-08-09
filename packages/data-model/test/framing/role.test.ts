import { INTEROP } from '@janeirodigital/interop-utils'
import { describe, test } from 'vitest'
import { fromJsonLd as roleFromJsonLd } from '../../src/crud/role'
import { expect } from '../expect'
import { docFromGraphs } from './helpers'

const ROLE_IRI = 'https://registry/alice/role/ps8hc3'

// Graph <https://registry/alice/role/ps8hc3> in registry.trig: a Role with
// skos:prefLabel and interop:hasMember.
describe('Role framing', () => {
  test('frames the role graph into RoleData', async () => {
    const doc = await docFromGraphs([ROLE_IRI])
    const role = await roleFromJsonLd(doc, ROLE_IRI)
    expect(role).toEqual({
      id: ROLE_IRI,
      type: [INTEROP.Role],
      prefLabel: 'Corps',
      members: ['https://id/acme'],
    })
  })
})
