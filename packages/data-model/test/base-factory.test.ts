import { randomUUID } from 'node:crypto'
import { fetch } from '@janeirodigital/interop-test-utils'
import { parseTurtle } from '@janeirodigital/interop-utils'
import { describe, expect, test } from 'vitest'
import { BaseFactory, Grant, ReadableApplicationRegistration } from '../src'

describe('constructor', () => {
  test('should set fetch', () => {
    const factory = new BaseFactory({ fetch, randomUUID })
    expect(factory.fetch).toBe(fetch)
  })
})

test('builds application registration', async () => {
  const factory = new BaseFactory({ fetch, randomUUID })
  const applicationRegistrationUrl =
    'https://auth.alice.example/bcf22534-0187-4ae4-b88f-fe0f9fa96659'
  const applicationRegistration = await factory.readable.applicationRegistration(
    applicationRegistrationUrl
  )
  expect(applicationRegistration).toBeInstanceOf(ReadableApplicationRegistration)
})

test('throws for grant with invalid scope', async () => {
  const invalidGrantDataset = await parseTurtle(`
    PREFIX interop: <http://www.w3.org/ns/solid/interop#>
    PREFIX foo: <https://foo.example/>
    foo:bar interop:scopeOfGrant interop:NonExistingScope .
  `)
  const fakeFetch = (url: string) =>
    Promise.resolve({ dataset: () => invalidGrantDataset, ok: true, url })
  // @ts-ignore
  const factory = new BaseFactory({ fetch: fakeFetch, randomUUID })
  const grant = await factory.readable.dataGrant('https://foo.example/bar')
  // getDataInstanceIterator is an async generator, error only surfaces on iteration
  const iterator = Grant.getDataInstanceIterator(grant, factory)
  await expect(iterator.next()).rejects.toThrow('Unknown scope')
})
