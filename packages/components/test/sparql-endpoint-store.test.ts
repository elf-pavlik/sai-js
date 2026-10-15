import { describe, expect, test } from 'vitest'

import { SPARQL_ENDPOINT_STORAGE_TYPE, SparqlEndpointStore } from '../src/SparqlEndpointStore.js'

/** Minimal in-memory stand-in for the CSS AccountLoginStorage. */
function fakeStorage() {
  const records: any[] = []
  const calls: any[] = []
  return {
    records,
    calls,
    defineType: async (...args: any[]) => {
      calls.push(['defineType', ...args])
    },
    createIndex: async (...args: any[]) => {
      calls.push(['createIndex', ...args])
    },
    create: async (_type: string, value: any) => {
      const record = { ...value, id: value.id ?? `id-${records.length}` }
      records.push(record)
      return record
    },
    find: async (_type: string, query: any) =>
      records.filter((record) =>
        Object.entries(query).every(([key, value]) => record[key] === value)
      ),
    delete: async (_type: string, id: string) => {
      const index = records.findIndex((record) => record.id === id)
      if (index >= 0) records.splice(index, 1)
    },
  }
}

const registryPod = {
  accountId: 'acc',
  webId: 'https://id/alice',
  podUrl: 'https://registry/alice/',
  endpoint: 'http://fuseki:3030/shared/sparql',
}
const dataPod = {
  accountId: 'acc',
  webId: 'https://id/alice',
  podUrl: 'https://data/alice-home/',
  endpoint: 'http://fuseki:3030/shared/sparql',
}

describe('SparqlEndpointStore', () => {
  test('defines the type and its indexes once', async () => {
    const storage = fakeStorage()
    const store = new SparqlEndpointStore(storage as any)

    await store.handle()
    await store.handle() // idempotent

    const defined = storage.calls.filter((call) => call[0] === 'defineType')
    expect(defined).toHaveLength(1)
    expect(defined[0][1]).toBe(SPARQL_ENDPOINT_STORAGE_TYPE)
    expect(defined[0][3]).toBe(false)

    const indexed = storage.calls.filter((call) => call[0] === 'createIndex').map((call) => call[2])
    expect(indexed).toEqual(['webId', 'podUrl'])
  })

  test('creates records and resolves any pod URL to its endpoint', async () => {
    const storage = fakeStorage()
    const store = new SparqlEndpointStore(storage as any)
    await store.handle()

    await store.create(registryPod)
    await store.create(dataPod)

    expect((await store.findByPodUrl('https://registry/alice/'))?.endpoint).toBe(
      'http://fuseki:3030/shared/sparql'
    )
    expect((await store.findByPodUrl('https://data/alice-home/'))?.webId).toBe('https://id/alice')
    expect(await store.findByPodUrl('https://data/alice-work/')).toBeUndefined()
    expect(await store.findByWebId('https://id/alice')).toHaveLength(2)
    expect(await store.findByWebId('https://id/bob')).toHaveLength(0)
  })

  test('delete removes a record', async () => {
    const storage = fakeStorage()
    const store = new SparqlEndpointStore(storage as any)
    await store.handle()
    await store.create(registryPod)

    const [record] = await store.findByWebId('https://id/alice')
    await store.delete(record.id)

    expect(await store.findByPodUrl('https://registry/alice/')).toBeUndefined()
    expect(await store.findByWebId('https://id/alice')).toHaveLength(0)
  })
})
