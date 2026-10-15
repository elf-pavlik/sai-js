import { afterAll, afterEach, describe, expect, test, vi } from 'vitest'

const state = vi.hoisted(() => ({
  selectRows: [] as any[],
  inserted: {} as Record<string, string>,
}))

vi.mock('postgres', () => {
  const sql: any = (strings: any, ...values: any[]) => {
    // tagged template (`sql\`...\``)
    if (Array.isArray(strings) && strings.raw) {
      const text = strings.join('?')
      if (text.includes('SELECT')) {
        return Promise.resolve(state.selectRows)
      }
      if (text.includes('INSERT')) {
        const entries = values[1] as { key: string; value: string }[]
        for (const entry of entries) state.inserted[entry.key] = entry.value
        return Promise.resolve([])
      }
      return Promise.resolve([])
    }
    // identifier helper (`sql(name)`)
    return strings
  }
  return { default: () => sql }
})

import { AccountService } from '../src/services/Account.js'

// the object endpoint values are copied from the environment for now
const originalS3Env = {
  endpoint: process.env.CSS_S3_ENDPOINT,
  bucket: process.env.CSS_S3_BUCKET,
  accessKeyId: process.env.CSS_S3_ACCESS_KEY_ID,
  secretAccessKey: process.env.CSS_S3_SECRET_ACCESS_KEY,
}
process.env.CSS_S3_ENDPOINT = 'http://garage:3900'
process.env.CSS_S3_BUCKET = 'sai-dev'
process.env.CSS_S3_ACCESS_KEY_ID = 'access-key'
process.env.CSS_S3_SECRET_ACCESS_KEY = 'secret-key'
afterAll(() => {
  process.env.CSS_S3_ENDPOINT = originalS3Env.endpoint
  process.env.CSS_S3_BUCKET = originalS3Env.bucket
  process.env.CSS_S3_ACCESS_KEY_ID = originalS3Env.accessKeyId
  process.env.CSS_S3_SECRET_ACCESS_KEY = originalS3Env.secretAccessKey
})

const fusekiBase = 'http://fuseki:3030'
const sharedSparql = 'http://fuseki:3030/shared/sparql'

const service = new AccountService(
  fusekiBase,
  'postgres://temporal:temporal@postgresql:5432/auth',
  'key_value',
  'https://auth/',
  'id',
  'id',
  'data',
  'registry'
)

afterEach(() => {
  state.selectRows = []
  state.inserted = {}
  vi.unstubAllGlobals()
})

describe('AccountService.bootstrapAccount — typed endpoint registry', () => {
  test('writes SPARQL + object endpoint records (pod-keyed) and their indexes', async () => {
    state.selectRows = [{ value: JSON.stringify({ linkedLoginsCount: 1, id: 'acc-1' }) }]
    const fetchMock = vi.fn(async () => ({ ok: true }))
    vi.stubGlobal('fetch', fetchMock)

    const webId = await service.bootstrapAccount('acc-1', 'alice')
    expect(webId).toBe('https://alice.id')

    // the WebID profile goes to the id service's own dataset (Graph Store
    // endpoint), NOT the shared / query-update endpoint
    expect(fetchMock).toHaveBeenCalledWith(
      'http://fuseki:3030/id/data',
      expect.objectContaining({ method: 'POST' })
    )
    expect(fetchMock).not.toHaveBeenCalledWith(
      sharedSparql,
      expect.objectContaining({ method: 'POST' })
    )

    const accountData = JSON.parse(state.inserted['accounts/data/acc-1'])
    const records = Object.values(accountData['**sparqlEndpoint**']) as any[]
    expect(records).toHaveLength(2)

    const registryRecord = records.find((record) => record.podUrl === 'https://registry/alice/')
    const dataRecord = records.find((record) => record.podUrl === 'https://alice.data/')
    expect(registryRecord).toMatchObject({
      accountId: 'acc-1',
      podUrl: 'https://registry/alice/',
      endpoint: 'http://fuseki:3030/reg-alice/sparql',
    })
    expect(dataRecord).toMatchObject({
      accountId: 'acc-1',
      podUrl: 'https://alice.data/',
      endpoint: 'http://fuseki:3030/data-alice/sparql',
    })
    // endpoints are associated with the pod, not the user
    expect(registryRecord.webId).toBeUndefined()
    expect(dataRecord.webId).toBeUndefined()

    // the data pod also gets a typed object (S3) endpoint, copied from env
    const objectRecords = Object.values(accountData['**objectEndpoint**']) as any[]
    expect(objectRecords).toHaveLength(1)
    const objectRecord = objectRecords[0]
    expect(objectRecord).toMatchObject({
      accountId: 'acc-1',
      podUrl: 'https://alice.data/',
      endpoint: 'http://garage:3900',
      bucket: 'sai-dev',
      accessKeyId: 'access-key',
      secretAccessKey: 'secret-key',
    })

    // the bootstrap TriG is POSTed per dataset: WebID profile to the id
    // dataset, registry set + data registry to their own datasets
    expect(fetchMock).toHaveBeenCalledWith(
      'http://fuseki:3030/id/data',
      expect.objectContaining({ method: 'POST' })
    )
    expect(fetchMock).toHaveBeenCalledWith(
      'http://fuseki:3030/reg-alice/data',
      expect.objectContaining({ method: 'POST' })
    )
    expect(fetchMock).toHaveBeenCalledWith(
      'http://fuseki:3030/data-alice/data',
      expect.objectContaining({ method: 'POST' })
    )

    // indexes: by id (one per record), accountId, podUrl
    const indexKeys = Object.keys(state.inserted).filter((key) =>
      key.startsWith('accounts/index/sparqlEndpoint/')
    )
    expect(indexKeys).toContain(`accounts/index/sparqlEndpoint/${registryRecord.id}`)
    expect(indexKeys).toContain(`accounts/index/sparqlEndpoint/${dataRecord.id}`)
    expect(indexKeys).toContain(`accounts/index/sparqlEndpoint/accountId/acc-1`)
    expect(indexKeys).toContain(
      `accounts/index/sparqlEndpoint/podUrl/${encodeURIComponent('https://registry/alice/')}`
    )
    expect(indexKeys).toContain(
      `accounts/index/sparqlEndpoint/podUrl/${encodeURIComponent('https://alice.data/')}`
    )
    for (const key of indexKeys) {
      expect(JSON.parse(state.inserted[key])).toEqual(['acc-1'])
    }

    const objectIndexKeys = Object.keys(state.inserted).filter((key) =>
      key.startsWith('accounts/index/objectEndpoint/')
    )
    expect(objectIndexKeys).toContain(`accounts/index/objectEndpoint/${objectRecord.id}`)
    expect(objectIndexKeys).toContain(`accounts/index/objectEndpoint/accountId/acc-1`)
    expect(objectIndexKeys).toContain(
      `accounts/index/objectEndpoint/podUrl/${encodeURIComponent('https://alice.data/')}`
    )
    for (const key of objectIndexKeys) {
      expect(JSON.parse(state.inserted[key])).toEqual(['acc-1'])
    }
  })
})
