import { randomUUID } from 'node:crypto'
import { fetch } from '@janeirodigital/interop-test-utils'
import { parseTurtle } from '@janeirodigital/interop-utils'
import * as jsonldNs from 'jsonld'
import { describe, expect, test } from 'vitest'
import { BaseFactory, Grant, ReadableApplicationRegistration } from '../src'

// CJS/ESM interop
const jsonld = (jsonldNs as any).default ?? jsonldNs

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
  // Build an RdfFetch-compatible mock: .raw returns JSON-LD from the invalid dataset
  async function rawFetch(url: string, options?: any) {
    const expanded = await jsonld.fromRDF(invalidGrantDataset)
    return {
      ok: true,
      url,
      headers: new Map([['Content-Type', 'application/ld+json']]),
      json: async () => expanded,
      text: async () => '',
      clone: function () { return this },
    }
  }
  const rdfFetch = rawFetch as any
  rdfFetch.raw = rawFetch
  const factory = new BaseFactory({ fetch: rdfFetch, randomUUID })
  const grant = await factory.readable.dataGrant('https://foo.example/bar')
  // getDataInstanceIterator is an async generator, error only surfaces on iteration
  const iterator = Grant.getDataInstanceIterator(grant, factory)
  await expect(iterator.next()).rejects.toThrow('Unknown scope')
})
