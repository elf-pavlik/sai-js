import { randomUUID } from 'node:crypto'
import { fetch } from '@janeirodigital/interop-test-utils'
import { ACL, INTEROP } from '@janeirodigital/interop-utils'
import { describe, expect, test } from 'vitest'
import { AuthorizationAgentFactory } from '../src'

const webId = 'https://alice.example/#id'
const agentId = 'https://jarvis.alice.example/#agent'

describe('crud', () => {
  const factory = new AuthorizationAgentFactory(webId, agentId, { fetch, randomUUID })
  test('builds application registration', async () => {
    const agentRegistrationUrl = 'https://auth.alice.example/bcf22534-0187-4ae4-b88f-fe0f9fa96659'
    const agentRegistration = await factory.crud.applicationRegistration(agentRegistrationUrl)
    expect(agentRegistration).toHaveProperty('id', agentRegistrationUrl)
    expect(agentRegistration).toHaveProperty('registeredAgent', 'https://projectron.example/#app')
    expect(agentRegistration).toHaveProperty('name', 'Projectron')
  })

  test('builds social agent registration', async () => {
    const agentRegistrationUrl = 'https://auth.alice.example/b1f69979-dd47-4709-b2ed-a7119f29b135'
    const agentRegistration = await factory.crud.socialAgentRegistration(agentRegistrationUrl)
    expect(agentRegistration).toHaveProperty('id', agentRegistrationUrl)
    expect(agentRegistration).toHaveProperty('registeredAgent')
  })

  test('authorizationRegistry', async () => {
    const snippetIri = 'https://auth.alice.example/96feb105-063e-4996-ab74-5e504c6ceae5'
    const authorizationRegistry = await factory.crud.authorizationRegistry(snippetIri)
    expect(authorizationRegistry).toHaveProperty('id', snippetIri)
  })

  test('dataRegistry', async () => {
    const snippetIri = 'https://home.alice.example/2d3d97b4-a26d-434e-afa2-e3bc8e8e2b56/'
    const dataRegistry = await factory.crud.dataRegistry(snippetIri)
    expect(dataRegistry).toHaveProperty('id', snippetIri)
  })

  test('agentRegistry', async () => {
    const snippetIri = 'https://auth.alice.example/1cf3e08b-ffe2-465a-ac5b-94ce165cb8f0'
    const agentRegistry = await factory.crud.agentRegistry(snippetIri)
    expect(agentRegistry).toHaveProperty('id', snippetIri)
  })

  test('socialAgentRegistration', async () => {
    const snippetIri = 'https://auth.alice.example/5dc3c14e-7830-475f-b8e3-4748d6c0bccb'
    const socialAgentRegistration = await factory.crud.socialAgentRegistration(snippetIri)
    expect(socialAgentRegistration).toHaveProperty('id', snippetIri)
    expect(socialAgentRegistration).toHaveProperty('reciprocalRegistration')
  })
  test.skip('registrySet', async () => {
    const snippetIri = 'https://auth.alice.example/13e60d32-77a6-4239-864d-cfe2c90807c8'
    const registrySet = await factory.crud.registrySet(snippetIri)
    expect(registrySet).toHaveProperty('id', snippetIri)
  })
})

describe('immutable', () => {
  describe('data grant', () => {
    const commonData = {
      dataOwner: 'https://alice.example/#id',
      registeredShapeTree: 'https://solidshapes.example/tree/Project',
      hasDataRegistration: 'https://pro.alice.example/123',
      accessMode: [ACL.Read.value],
    }

    test('builds AllFromRegistry data grant', async () => {
      const allFromRegistryData = {
        scopeOfGrant: INTEROP.AllFromRegistry.value,
        ...commonData,
      }
      const factory = new AuthorizationAgentFactory(webId, agentId, { fetch, randomUUID })
      const dataGrantIri = 'https://auth.alice.example/7b2bc4ff-b4b8-47b8-96f6-06695f4c5126'
      const dataGrant = factory.immutable.dataGrant(dataGrantIri, allFromRegistryData)
      expect(dataGrant).toHaveProperty('id', dataGrantIri)
      expect(dataGrant).toHaveProperty('scopeOfGrant', INTEROP.AllFromRegistry.value)
    })

    test('builds SelectedFromRegistry data grant', async () => {
      const selectedFromRegistryData = {
        scopeOfGrant: INTEROP.SelectedFromRegistry.value,
        ...commonData,
      }
      const factory = new AuthorizationAgentFactory(webId, agentId, { fetch, randomUUID })
      const dataGrantIri = 'https://auth.alice.example/cd247a67-0879-4301-abd0-828f63abb252'
      const dataGrant = factory.immutable.dataGrant(dataGrantIri, selectedFromRegistryData)
      expect(dataGrant).toHaveProperty('id', dataGrantIri)
      expect(dataGrant).toHaveProperty('scopeOfGrant', INTEROP.SelectedFromRegistry.value)
    })

    test('builds Inherited data grant', async () => {
      const inheritnstancesData = {
        scopeOfGrant: INTEROP.Inherited.value,
        ...commonData,
      }
      const factory = new AuthorizationAgentFactory(webId, agentId, { fetch, randomUUID })
      const dataGrantIri = 'https://auth.alice.example/9827ae00-2778-4655-9f22-08bb9daaee26'
      const dataGrant = factory.immutable.dataGrant(dataGrantIri, inheritnstancesData)
      expect(dataGrant).toHaveProperty('id', dataGrantIri)
      expect(dataGrant).toHaveProperty('scopeOfGrant', INTEROP.Inherited.value)
    })
  })
})

describe('readable', () => {
  const factory = new AuthorizationAgentFactory(webId, agentId, { fetch, randomUUID })
  test('dataAuthorization', async () => {
    const snippetIri = 'https://auth.alice.example/e2765d6c-848a-4fc0-9092-556903730263'
    const dataAuthorization = await factory.readable.dataAuthorization(snippetIri)
    expect(dataAuthorization.id).toBe(snippetIri)
    expect(dataAuthorization.grantee).toBe('https://projectron.example/#app')
    expect(dataAuthorization.grantedBy).toBe(webId)
    expect(dataAuthorization.scopeOfAuthorization).toBe(INTEROP.AllFromAgent.value)
  })
})
