import { buildOidcSession } from '@elfpavlik/sai-components'
import {
  AgentRegistrationDiscoveryError,
  DescriptionResourceDiscoveryError,
  discoverAgentRegistration,
  discoverAuthorizationAgent,
  discoverAuthorizationRedirectEndpoint,
  discoverDescriptionResource,
  discoverStorageDescription,
  discoverWebPushService,
} from '@janeirodigital/interop-utils'
import { describe, expect, test } from 'vitest'

const aliceId = 'https://id/alice'
const aliceAgentId = 'https://auth/.sai/agents/aHR0cHM6Ly9pZC9hbGljZQ'
const testClient = 'https://data/test-client/public/id'
const missingClient = 'https://missing.example'

describe('discoverAuthorizationAgent', () => {
  test('should discover Authorization Agent from the WebID document', async () => {
    const iri = await discoverAuthorizationAgent(aliceId, fetch)
    expect(iri).toBe(aliceAgentId)
  })
})

describe('discoverAgentRegistration', () => {
  test('should discover Agent Registration from link header', async () => {
    const session = await buildOidcSession(aliceId, testClient)
    const iri = await discoverAgentRegistration(aliceAgentId, session.authFetch.bind(session))
    expect(iri).toBe('https://registry/alice/application/cvmsa4/')
  })

  test('should return undefined if no link header', async () => {
    const session = await buildOidcSession(aliceId, missingClient)
    const iri = await discoverAgentRegistration(aliceAgentId, session.authFetch.bind(session))
    expect(iri).toBeUndefined()
  })

  test('should throw error if the request fails', async () => {
    await expect(
      discoverAgentRegistration('https://registry/nonexistent-path/', fetch)
    ).rejects.toThrowError(AgentRegistrationDiscoveryError)
  })
})

describe('discoverDescriptionResource', () => {
  test('should discover Description Resource from link header', async () => {
    const iri = await discoverDescriptionResource(testClient, fetch)
    expect(iri).toBe('https://data/test-client/public/id.meta')
  })

  test('should return undefined if no link header', async () => {
    const iri = await discoverDescriptionResource(aliceAgentId, fetch)
    expect(iri).toBeUndefined()
  })

  test('should throw error if the request fails', async () => {
    await expect(
      discoverDescriptionResource('https://registry/nonexistent-path/', fetch)
    ).rejects.toThrowError(DescriptionResourceDiscoveryError)
  })
})

describe('discoverStorageDescription', () => {
  test('should discover storage description for data/test-client', async () => {
    const iri = await discoverStorageDescription('https://data/test-client/public/id', fetch)
    expect(iri).toBe('https://data/test-client/.well-known/solid')
  })
})

describe('discoverAuthorizationRedirectEndpoint', () => {
  test('should discover authorization uri from Client ID document', async () => {
    const iri = await discoverAuthorizationRedirectEndpoint(testClient, fetch)
    expect(iri).toBe('https://ui.auth/authorize')
  })
})

describe('discoverWebPushService', () => {
  test('should discover web push service from Client ID document', async () => {
    const { id, vapidPublicKey } = await discoverWebPushService(testClient, fetch)
    expect(id).toBe('https://auth/.sai/webpush')
    expect(vapidPublicKey).toBe(
      'BNUaG9vwp-WE_cX-3dNLebyczW_RivE8wHECIvZIUMUZ3co6P79neE3hueJJtFcg5ezTZ25T1ITciujz-mlAcnY'
    )
  })

  test('returns undefined if service not found', async () => {
    expect(await discoverWebPushService(aliceAgentId, fetch)).toBeUndefined()
  })
})
