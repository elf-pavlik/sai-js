import { randomUUID } from 'node:crypto'
import { fetch } from '@janeirodigital/interop-test-utils'
import { describe, test } from 'vitest'
import { loadApplicationRegistration } from '../../src'
import { expect } from '../expect'

const deps = { fetch, randomUUID }
const snippetIri = 'https://auth.alice.example/bcf22534-0187-4ae4-b88f-fe0f9fa96659'

describe('getters', () => {
  test('id', async () => {
    const applicationRegistration = await loadApplicationRegistration(snippetIri, deps.fetch)
    expect(applicationRegistration.id).toEqual(snippetIri)
  })

  test('registeredAgent', async () => {
    const applicationRegistration = await loadApplicationRegistration(snippetIri, deps.fetch)
    expect(applicationRegistration.registeredAgent).toEqual('https://projectron.example/#app')
  })

  test('hasDataGrant', async () => {
    const applicationRegistration = await loadApplicationRegistration(snippetIri, deps.fetch)
    expect(applicationRegistration.hasDataGrant.length).toBeGreaterThan(0)
    for (const grantIri of applicationRegistration.hasDataGrant) {
      expect(typeof grantIri).toBe('string')
    }
  })

  test('granted', async () => {
    const applicationRegistration = await loadApplicationRegistration(snippetIri, deps.fetch)
    expect(applicationRegistration.granted).toBe(true)
  })
})
