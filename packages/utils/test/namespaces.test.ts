import { describe, expect, test } from 'vitest'
import { ACL, INTEROP, RDF } from '../src/namespaces'

describe('vocabularies', () => {
  test('members are full IRIs as strings', () => {
    expect(INTEROP.hasDataRegistration).toBe(
      'http://www.w3.org/ns/solid/interop#hasDataRegistration'
    )
    expect(INTEROP.hasRegistrySet).toBe('http://www.w3.org/ns/solid/interop#hasRegistrySet')
    expect(ACL.Read).toBe('http://www.w3.org/ns/auth/acl#Read')
    expect(RDF.type).toBe('http://www.w3.org/1999/02/22-rdf-syntax-ns#type')
  })

  test('namespace is the vocabulary base IRI', () => {
    expect(INTEROP.namespace).toBe('http://www.w3.org/ns/solid/interop#')
    expect(ACL.namespace).toBe('http://www.w3.org/ns/auth/acl#')
  })

  test('terms exposes NamedNodes with the same values', () => {
    const term = INTEROP.terms.hasDataRegistration
    expect(term.termType).toBe('NamedNode')
    expect(term.value).toBe('http://www.w3.org/ns/solid/interop#hasDataRegistration')
    expect(ACL.terms.Read.value).toBe('http://www.w3.org/ns/auth/acl#Read')
  })
})
