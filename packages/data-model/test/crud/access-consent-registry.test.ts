import { randomUUID } from 'node:crypto'
import { fetch } from '@janeirodigital/interop-test-utils'
import { describe, test } from 'vitest'
import {
  AuthorizationAgentFactory,
  AuthorizationRegistry,
  getDataAuthorizationIris,
} from '../../src'
import { expect } from '../expect'

const webId = 'https://alice.example/#id'
const agentId = 'https://jarvis.alice.example/#agent'
const factory = new AuthorizationAgentFactory(webId, agentId, { fetch, randomUUID })
const snippetIri = 'https://auth.alice.example/96feb105-063e-4996-ab74-5e504c6ceae5'

test('should provide dataAuthorizations', async () => {
  const registry = await factory.crud.authorizationRegistry(snippetIri)
  let count = 0
  for await (const dataAuthorization of AuthorizationRegistry.dataAuthorizations(
    registry,
    factory
  )) {
    count += 1
    expect(dataAuthorization).toHaveProperty('grantee')
    expect(dataAuthorization).toHaveProperty('grantedBy')
  }
  expect(count).toBe(6)
})

test('should provide iriForContained function', async () => {
  const registry = await factory.crud.authorizationRegistry(snippetIri)
  expect(AuthorizationRegistry.iriForContained(registry, factory)).toMatch(registry.id)
})

describe('getDataAuthorizationIris', () => {
  test('should return iris of contained data authorizations', async () => {
    const registry = await factory.crud.authorizationRegistry(snippetIri)
    const iris = await getDataAuthorizationIris(registry, factory)
    expect(iris).toHaveLength(6)
    expect(iris).toContain('https://auth.alice.example/e2765d6c-848a-4fc0-9092-556903730263')
    expect(iris).toContain('https://auth.alice.example/a691ee69-97d8-45c0-bb03-8e887b2db806')
  })
})

describe('findDataAuthorizations', () => {
  test('should return data authorizations if exist', async () => {
    const registry = await factory.crud.authorizationRegistry(snippetIri)
    const agentIri = 'https://projectron.example/#app'
    const dataAuthorizations = await AuthorizationRegistry.findDataAuthorizations(
      registry,
      factory,
      agentIri
    )
    expect(dataAuthorizations).toHaveLength(4)
    for (const dataAuthorization of dataAuthorizations) {
      expect(dataAuthorization.grantee).toBe(agentIri)
    }
  })

  test('should return empty array if no data authorization for grantee', async () => {
    const registry = await factory.crud.authorizationRegistry(snippetIri)
    const agentIri = 'https://non-existing.example/#oops'
    const dataAuthorizations = await AuthorizationRegistry.findDataAuthorizations(
      registry,
      factory,
      agentIri
    )
    expect(dataAuthorizations).toEqual([])
  })
})

describe('findAuthorizationsDelegatingFromOwner', () => {
  test('should find all authorizations delegating from given data owner', async () => {
    const registry = await factory.crud.authorizationRegistry(snippetIri)
    const ownerIri = 'https://acme.example/#corp'
    const authorizations = await AuthorizationRegistry.findAuthorizationsDelegatingFromOwner(
      registry,
      factory,
      ownerIri
    )
    expect(authorizations).toHaveLength(2)
  })

  test('should find authorizations for data owned by alice', async () => {
    const registry = await factory.crud.authorizationRegistry(snippetIri)
    const ownerIri = 'https://alice.example/#id'
    const authorizations = await AuthorizationRegistry.findAuthorizationsDelegatingFromOwner(
      registry,
      factory,
      ownerIri
    )
    // a691ee69 is an All-scope authorization on alice-owned data (grantee is acme)
    expect(authorizations).toHaveLength(1)
  })
})
