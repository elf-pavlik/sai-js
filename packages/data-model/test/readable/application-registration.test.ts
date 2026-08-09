import { randomUUID } from 'node:crypto'
import { fetch } from '@janeirodigital/interop-test-utils'
import { describe, test } from 'vitest'
import { ApplicationFactory, ApplicationRegistration } from '../../src'
import { expect } from '../expect'

const factory = new ApplicationFactory({ fetch, randomUUID })
const snippetIri = 'https://auth.alice.example/bcf22534-0187-4ae4-b88f-fe0f9fa96659'

describe('getters', () => {
  test('id', async () => {
    const applicationRegistration = await factory.applicationRegistration(snippetIri)
    expect(applicationRegistration.id).toEqual(snippetIri)
  })

  test('registeredAgent', async () => {
    const applicationRegistration = await factory.applicationRegistration(snippetIri)
    expect(applicationRegistration.registeredAgent).toEqual('https://projectron.example/#app')
  })

  test('hasDataGrant', async () => {
    const applicationRegistration = await factory.applicationRegistration(snippetIri)
    expect(applicationRegistration.hasDataGrant.length).toBeGreaterThan(0)
    for (const grantIri of applicationRegistration.hasDataGrant) {
      expect(typeof grantIri).toBe('string')
    }
  })

  test('granted', async () => {
    const applicationRegistration = await factory.applicationRegistration(snippetIri)
    expect(applicationRegistration.granted).toBe(true)
    expect(ApplicationRegistration.getGranted(applicationRegistration)).toBe(true)
  })
})

describe('getDataGrants', () => {
  test('should provide data grants', async () => {
    const applicationRegistration = await factory.applicationRegistration(snippetIri)
    const dataGrants = await ApplicationRegistration.getDataGrants(applicationRegistration, factory)
    expect(dataGrants.length).toBeGreaterThan(0)
  })
})
