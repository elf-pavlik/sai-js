import { randomUUID } from 'node:crypto'
import { fetch } from '@janeirodigital/interop-test-utils'
import { describe, test, vi } from 'vitest'
import { AuthorizationAgentFactory, type DataRegistrationData, DataRegistry } from '../../src'
import { expect } from '../expect'

const webId = 'https://alice.example/#id'
const agentId = 'https://jarvis.alice.example/#agent'
const factory = new AuthorizationAgentFactory({ fetch, randomUUID })
const snippetIri = 'https://home.alice.example/2d3d97b4-a26d-434e-afa2-e3bc8e8e2b56/'

test('hasDataRegistration', async () => {
  const dataRegistry = await factory.dataRegistry(snippetIri)
  expect(await DataRegistry.hasDataRegistration(dataRegistry, factory)).toHaveLength(2)
})

test('registrations', async () => {
  const dataRegistry = await factory.dataRegistry(snippetIri)
  let count = 0
  for await (const registration of DataRegistry.registrations(dataRegistry, factory)) {
    expect(registration.id).toBeTypeOf('string')
    expect(registration.registeredShapeTree).toBeTypeOf('string')
    count += 1
  }
  expect(count).toBe(2)
})

test('storageIri', async () => {
  const dataRegistry = await factory.dataRegistry(snippetIri)
  const iri = await DataRegistry.storageIri(dataRegistry, factory)
  expect(iri).toBe('https://fake.example/storage-desription')
})

describe('createRegistration', () => {
  const projectShapeTree = 'https://solidshapes.example/trees/Project'

  test('should throw if registration for given shape tree exists', async () => {
    const dataRegistry = await factory.dataRegistry(snippetIri)
    await expect(
      DataRegistry.createRegistration(
        dataRegistry,
        factory,
        { agent: webId, client: agentId },
        projectShapeTree
      )
    ).rejects.toThrow('registration already exists')
  })

  test('should return created data registration', async () => {
    const otherShapeTree = 'https://solidshapes.example/tree/Other'
    const dataRegistry = await factory.dataRegistry(snippetIri)
    const registration = await DataRegistry.createRegistration(
      dataRegistry,
      factory,
      { agent: webId, client: agentId },
      otherShapeTree
    )
    expect(registration.registeredShapeTree).toBe(otherShapeTree)
    expect(registration.id).toMatch(snippetIri)
  })

  test('should build data registration via the factory', async () => {
    const localFactory = new AuthorizationAgentFactory({ fetch, randomUUID })
    const dataRegistrationMock = vi.fn(
      async (iri: string, data?: DataRegistrationData): Promise<DataRegistrationData> => ({
        id: iri,
        type: data?.type ?? [],
        registeredShapeTree: data?.registeredShapeTree ?? '',
        contains: data?.contains ?? [],
      })
    )
    localFactory.dataRegistration = dataRegistrationMock

    const otherShapeTree = 'https://solidshapes.example/tree/Other'
    const dataRegistry = await localFactory.dataRegistry(snippetIri)
    await DataRegistry.createRegistration(
      dataRegistry,
      localFactory,
      { agent: webId, client: agentId },
      otherShapeTree
    )

    expect(dataRegistrationMock).toBeCalledWith(
      expect.any(String),
      expect.objectContaining({ registeredShapeTree: otherShapeTree })
    )
  })

  test('should link to new data registration and update itself', async () => {
    const patchFetch = vi.fn(fetch)
    const localFactory = new AuthorizationAgentFactory({
      fetch: patchFetch,
      randomUUID,
    })
    const otherShapeTree = 'https://solidshapes.example/tree/Other'
    const dataRegistry = await localFactory.dataRegistry(snippetIri)
    const registration = await DataRegistry.createRegistration(
      dataRegistry,
      localFactory,
      { agent: webId, client: agentId },
      otherShapeTree
    )
    expect(patchFetch).toBeCalledWith(
      expect.any(String),
      expect.objectContaining({
        method: 'PATCH',
        body: expect.stringContaining(registration.id),
      })
    )
  })
})
