import { randomUUID } from 'node:crypto'
import { fetch } from '@janeirodigital/interop-test-utils'
import { INTEROP } from '@janeirodigital/interop-utils'
import { DataFactory } from 'n3'
import { beforeEach, describe, test, vi } from 'vitest'
import {
  AuthorizationAgentFactory,
  type CRUDAuthorizationRegistry,
  addDataAuthorization,
  getDataAuthorizationIris,
  removeDataAuthorization,
} from '../../src'
import { expect } from '../expect'

const webId = 'https://alice.example/#id'
const agentId = 'https://jarvis.alice.example/#agent'
const factory = new AuthorizationAgentFactory(webId, agentId, { fetch, randomUUID })
const snippetIri = 'https://auth.alice.example/96feb105-063e-4996-ab74-5e504c6ceae5'

test('should provide dataAuthorizations', async () => {
  const registry = await factory.crud.authorizationRegistry(snippetIri)
  let count = 0
  for await (const dataAuthorization of registry.dataAuthorizations()) {
    count += 1
    expect(dataAuthorization).toHaveProperty('grantee')
    expect(dataAuthorization).toHaveProperty('grantedBy')
  }
  expect(count).toBe(6)
})

test('should provide iriForContained method', async () => {
  const registry = await factory.crud.authorizationRegistry(snippetIri)
  expect(registry.iriForContained()).toMatch(registry.iri)
})

describe('getDataAuthorizationIris', () => {
  test('should return iris of linked data authorizations', async () => {
    const registry = await factory.crud.authorizationRegistry(snippetIri)
    const iris = getDataAuthorizationIris(registry)
    expect(iris).toHaveLength(6)
    expect(iris).toContain('https://auth.alice.example/e2765d6c-848a-4fc0-9092-556903730263')
    expect(iris).toContain('https://auth.alice.example/a691ee69-97d8-45c0-bb03-8e887b2db806')
  })
})

describe('add', () => {
  let registry: CRUDAuthorizationRegistry

  beforeEach(async () => {
    registry = await factory.crud.authorizationRegistry(snippetIri)
  })

  test('should add new quad linking to added data authorization', async () => {
    const dataAuthorizationIri = 'https://auth.alice.example/25b18e05-7f75-4e13-94f6-9950a67a89dd'
    const quads = [
      DataFactory.quad(
        DataFactory.namedNode(registry.iri),
        INTEROP.hasDataAuthorization,
        DataFactory.namedNode(dataAuthorizationIri)
      ),
    ]
    expect(registry.dataset).not.toBeRdfDatasetContaining(...quads)
    await addDataAuthorization(registry, dataAuthorizationIri)
    expect(registry.dataset).toBeRdfDatasetContaining(...quads)
  })

  test('should add statement via addStatement', async () => {
    const addStatementSpy = vi.spyOn(registry, 'addStatement')
    const dataAuthorizationIri = 'https://auth.alice.example/25b18e05-7f75-4e13-94f6-9950a67a89dd'
    await addDataAuthorization(registry, dataAuthorizationIri)
    expect(addStatementSpy).toBeCalled()
  })

  test('should not remove links to other data authorizations', async () => {
    const numberOfAuthorizationsBefore = registry.getQuadArray(
      null,
      INTEROP.hasDataAuthorization
    ).length
    const dataAuthorizationIri = 'https://auth.alice.example/25b18e05-7f75-4e13-94f6-9950a67a89dd'
    await addDataAuthorization(registry, dataAuthorizationIri)
    const numberOfAuthorizationsAfter = registry.getQuadArray(
      null,
      INTEROP.hasDataAuthorization
    ).length
    expect(numberOfAuthorizationsAfter).toBe(numberOfAuthorizationsBefore + 1)
  })
})

describe('remove', () => {
  test('should remove link to data authorization', async () => {
    const registry = await factory.crud.authorizationRegistry(snippetIri)
    const dataAuthorizationIri = 'https://auth.alice.example/e2765d6c-848a-4fc0-9092-556903730263'
    const quads = [
      DataFactory.quad(
        DataFactory.namedNode(registry.iri),
        INTEROP.hasDataAuthorization,
        DataFactory.namedNode(dataAuthorizationIri)
      ),
    ]
    expect(registry.dataset).toBeRdfDatasetContaining(...quads)
    await removeDataAuthorization(registry, dataAuthorizationIri)
    expect(registry.dataset).not.toBeRdfDatasetContaining(...quads)
  })

  test('should do nothing if the data authorization is not linked', async () => {
    const registry = await factory.crud.authorizationRegistry(snippetIri)
    const removeStatementSpy = vi.spyOn(registry, 'removeStatement')
    const dataAuthorizationIri = 'https://auth.alice.example/25b18e05-7f75-4e13-94f6-9950a67a89dd'
    await removeDataAuthorization(registry, dataAuthorizationIri)
    expect(removeStatementSpy).not.toBeCalled()
  })
})

describe('findDataAuthorizations', () => {
  test('should return data authorizations if exist', async () => {
    const registry = await factory.crud.authorizationRegistry(snippetIri)
    const agentIri = 'https://projectron.example/#app'
    const dataAuthorizations = await registry.findDataAuthorizations(agentIri)
    expect(dataAuthorizations).toHaveLength(4)
    for (const dataAuthorization of dataAuthorizations) {
      expect(dataAuthorization.grantee).toBe(agentIri)
    }
  })

  test('should return empty array if no data authorization for grantee', async () => {
    const registry = await factory.crud.authorizationRegistry(snippetIri)
    const agentIri = 'https://non-existing.example/#oops'
    const dataAuthorizations = await registry.findDataAuthorizations(agentIri)
    expect(dataAuthorizations).toEqual([])
  })
})

describe('findAuthorizationsDelegatingFromOwner', () => {
  test('should find all authorizations delegating from given data owner', async () => {
    const registry = await factory.crud.authorizationRegistry(snippetIri)
    const ownerIri = 'https://acme.example/#corp'
    const authorizations = await registry.findAuthorizationsDelegatingFromOwner(ownerIri)
    expect(authorizations).toHaveLength(2)
  })

  test('should find authorizations for data owned by alice', async () => {
    const registry = await factory.crud.authorizationRegistry(snippetIri)
    const ownerIri = 'https://alice.example/#id'
    const authorizations = await registry.findAuthorizationsDelegatingFromOwner(ownerIri)
    // a691ee69 is an All-scope authorization on alice-owned data (grantee is acme)
    expect(authorizations).toHaveLength(1)
  })
})
