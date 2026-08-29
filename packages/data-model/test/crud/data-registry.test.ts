import { randomUUID } from 'node:crypto'
import { fetch } from '@janeirodigital/interop-test-utils'
import { describe, test, vi } from 'vitest'
import { DataRegistry } from '../../src'
import { expect } from '../expect'

const deps = { fetch, randomUUID }
const snippetIri = 'https://home.alice.example/2d3d97b4-a26d-434e-afa2-e3bc8e8e2b56/'

test('hasDataRegistration', async () => {
  const dataRegistry = await { id: snippetIri }
  expect(await DataRegistry.hasDataRegistration(dataRegistry, deps.fetch)).toHaveLength(2)
})

test('registrations', async () => {
  const dataRegistry = await { id: snippetIri }
  let count = 0
  for await (const registration of DataRegistry.registrations(dataRegistry, deps.fetch)) {
    expect(registration.id).toBeTypeOf('string')
    expect(registration.registeredShapeTree).toBeTypeOf('string')
    count += 1
  }
  expect(count).toBe(2)
})

test('storageIri', async () => {
  const dataRegistry = await { id: snippetIri }
  const iri = await DataRegistry.storageIri(dataRegistry, deps.fetch)
  expect(iri).toBe('https://fake.example/storage-desription')
})

describe('createRegistration', () => {
  const projectShapeTree = 'https://solidshapes.example/trees/Project'

  test('should throw if registration for given shape tree exists', async () => {
    const dataRegistry = await { id: snippetIri }
    await expect(
      DataRegistry.createRegistration(dataRegistry, deps, projectShapeTree)
    ).rejects.toThrow('registration already exists')
  })

  test('should return created data registration', async () => {
    const otherShapeTree = 'https://solidshapes.example/tree/Other'
    const dataRegistry = await { id: snippetIri }
    const registration = await DataRegistry.createRegistration(dataRegistry, deps, otherShapeTree)
    expect(registration.registeredShapeTree).toBe(otherShapeTree)
    expect(registration.id).toMatch(snippetIri)
  })

  test('should build a data registration POJO', async () => {
    const otherShapeTree = 'https://solidshapes.example/tree/Other'
    const dataRegistry = { id: snippetIri }
    const registration = await DataRegistry.createRegistration(dataRegistry, deps, otherShapeTree)
    expect(registration.registeredShapeTree).toBe(otherShapeTree)
    expect(registration.id).toMatch(snippetIri)
  })

  test('should link to new data registration and update itself', async () => {
    const patchFetch = vi.fn(fetch)
    const localDeps = { fetch: patchFetch, randomUUID }
    const otherShapeTree = 'https://solidshapes.example/tree/Other'
    const dataRegistry = { id: snippetIri }
    const registration = await DataRegistry.createRegistration(
      dataRegistry,
      localDeps,
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
