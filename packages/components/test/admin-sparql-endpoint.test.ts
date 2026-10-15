import { ForbiddenHttpError } from '@solid/community-server'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import { AdminSparqlHandler } from '../src/AdminSparqlHandler.js'
import type { SparqlEndpointRecord } from '../src/PodEndpointStore.js'

// registryId() derives the registry pod URL from the environment origins
const originalOrigins = { id: process.env.CSS_ID_ORIGIN, reg: process.env.CSS_REG_ORIGIN }
beforeAll(() => {
  process.env.CSS_ID_ORIGIN = 'id'
  process.env.CSS_REG_ORIGIN = 'registry'
})
afterAll(() => {
  process.env.CSS_ID_ORIGIN = originalOrigins.id
  process.env.CSS_REG_ORIGIN = originalOrigins.reg
})

const records: SparqlEndpointRecord[] = [
  {
    id: 'acme-reg',
    accountId: 'acme',
    podUrl: 'https://registry/acme/',
    endpoint: 'http://fuseki:3030/reg-acme/sparql',
  },
  {
    id: 'acme-data',
    accountId: 'acme',
    podUrl: 'https://data/acme-rnd/',
    endpoint: 'http://fuseki:3030/data-acme-rnd/sparql',
  },
  {
    id: 'yoyo-data',
    accountId: 'yoyo',
    podUrl: 'https://data/yoyo-eu/',
    endpoint: 'http://fuseki:3030/data-yoyo-eu/sparql',
  },
]

const store = {
  findSparqlByPodUrl: async (podUrl: string) => records.find((record) => record.podUrl === podUrl),
} as never

const accounts: Record<string, string> = {
  'https://id/acme': 'acme',
  'https://id/yoyo': 'yoyo',
}
const webIdStore = {
  findAccount: async (webId: string) => accounts[webId],
} as never

/** `resolveEndpoint` is private — the ownership rule is exercised directly. */
function resolve(orgWebId: string, podUrl?: string): Promise<string> {
  const handler = new AdminSparqlHandler(
    {} as never,
    {} as never,
    store,
    webIdStore
  ) as unknown as {
    resolveEndpoint(org: string, pod?: string): Promise<string>
  }
  return handler.resolveEndpoint(orgWebId, podUrl)
}

describe('AdminSparqlHandler endpoint resolution', () => {
  test('defaults to the org registry pod', async () => {
    await expect(resolve('https://id/acme')).resolves.toBe('http://fuseki:3030/reg-acme/sparql')
  })

  test('resolves another pod owned by the same org', async () => {
    await expect(resolve('https://id/acme', 'https://data/acme-rnd/')).resolves.toBe(
      'http://fuseki:3030/data-acme-rnd/sparql'
    )
  })

  test('rejects a pod owned by another account (403)', async () => {
    await expect(resolve('https://id/acme', 'https://data/yoyo-eu/')).rejects.toBeInstanceOf(
      ForbiddenHttpError
    )
  })

  test('rejects an unknown pod (403)', async () => {
    await expect(resolve('https://id/acme', 'https://data/does-not-exist/')).rejects.toBeInstanceOf(
      ForbiddenHttpError
    )
  })

  test('fails closed when the org has no registry record', async () => {
    await expect(resolve('https://id/nobody')).rejects.toThrow(
      'no registry-pod SPARQL endpoint for https://id/nobody'
    )
  })
})
