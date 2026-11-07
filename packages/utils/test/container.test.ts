import { randomUUID } from 'node:crypto'

import { describe, expect, test } from 'vitest'

import { iriForContained, isAuxiliaryResource } from '../src'

const iri = 'https://work.alice.example/something/'

describe('iriForContained', () => {
  test('generates a contained IRI from the container id', () => {
    const contained = iriForContained({ id: iri }, randomUUID)
    expect(contained).toMatch(iri)
    expect(contained.slice(iri.length)).not.toMatch(/\//)
  })

  test('appends a trailing slash when creating a container', () => {
    expect(iriForContained({ id: iri }, randomUUID, true).endsWith('/')).toBe(true)
  })
})

describe('isAuxiliaryResource', () => {
  test('matches access control and description auxiliaries', () => {
    expect(isAuxiliaryResource('https://work.alice.example/resource.acr')).toBe(true)
    expect(isAuxiliaryResource('https://work.alice.example/resource.acl')).toBe(true)
    expect(isAuxiliaryResource('https://work.alice.example/resource.meta')).toBe(true)
  })

  test('ignores query and fragment, and ordinary resources', () => {
    expect(isAuxiliaryResource('https://work.alice.example/resource.acr?ext=acl')).toBe(true)
    expect(isAuxiliaryResource('https://work.alice.example/resource#fragment')).toBe(false)
    expect(isAuxiliaryResource('https://work.alice.example/resource')).toBe(false)
    expect(isAuxiliaryResource('https://work.alice.example/acr/resource')).toBe(false)
  })
})
