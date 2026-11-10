import { describe, expect, test } from 'vitest'

import { isAuxiliaryResource } from '../src'

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
