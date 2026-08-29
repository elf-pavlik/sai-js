import { randomUUID } from 'node:crypto'
import { fetch } from '@janeirodigital/interop-test-utils'
import { describe, test } from 'vitest'
import { AuthorizationRegistry, getDataAuthorizationIris } from '../../src'
import { expect } from '../expect'

const deps = { fetch, randomUUID }
const snippetIri = 'https://auth.alice.example/96feb105-063e-4996-ab74-5e504c6ceae5'

test('should provide iriForContained function', async () => {
  const registry = { id: snippetIri }
  expect(AuthorizationRegistry.iriForContained(registry, deps.randomUUID)).toMatch(registry.id)
})

describe('getDataAuthorizationIris', () => {
  test('should return iris of contained data authorizations', async () => {
    const registry = { id: snippetIri }
    const iris = await getDataAuthorizationIris(registry, deps.fetch)
    expect(iris).toHaveLength(6)
    expect(iris).toContain('https://auth.alice.example/e2765d6c-848a-4fc0-9092-556903730263')
    expect(iris).toContain('https://auth.alice.example/a691ee69-97d8-45c0-bb03-8e887b2db806')
  })
})
