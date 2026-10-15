import { afterEach, describe, expect, test, vi } from 'vitest'

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

const endpoint = 'http://fuseki:3030/shared/sparql'

const service = new AccountService(
  endpoint,
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

describe('AccountService.bootstrapAccount — per-pod endpoint registry', () => {
  test('writes registry + data endpoint records and their indexes', async () => {
    state.selectRows = [{ value: JSON.stringify({ linkedLoginsCount: 1, id: 'acc-1' }) }]
    const fetchMock = vi.fn(async () => ({ ok: true }))
    vi.stubGlobal('fetch', fetchMock)

    const webId = await service.bootstrapAccount('acc-1', 'alice')
    expect(webId).toBe('https://alice.id')

    // bootstrap TriG still POSTed to the (shared) endpoint
    expect(fetchMock).toHaveBeenCalledWith(endpoint, expect.objectContaining({ method: 'POST' }))

    const accountData = JSON.parse(state.inserted['accounts/data/acc-1'])
    const records = Object.values(accountData['**sparqlEndpoint**']) as any[]
    expect(records).toHaveLength(2)

    const registryRecord = records.find((record) => record.podUrl === 'https://registry/alice/')
    const dataRecord = records.find((record) => record.podUrl === 'https://alice.data/')
    expect(registryRecord).toMatchObject({
      accountId: 'acc-1',
      webId: 'https://alice.id',
      podUrl: 'https://registry/alice/',
      endpoint: 'http://fuseki:3030/reg-alice/sparql',
    })
    expect(dataRecord).toMatchObject({
      accountId: 'acc-1',
      webId: 'https://alice.id',
      podUrl: 'https://alice.data/',
      endpoint: 'http://fuseki:3030/data-alice/sparql',
    })

    // the bootstrap TriG is POSTed per dataset: WebID profile to the shared
    // endpoint, registry set + data registry to their own datasets
    expect(fetchMock).toHaveBeenCalledWith(endpoint, expect.objectContaining({ method: 'POST' }))
    expect(fetchMock).toHaveBeenCalledWith(
      'http://fuseki:3030/reg-alice/data',
      expect.objectContaining({ method: 'POST' })
    )
    expect(fetchMock).toHaveBeenCalledWith(
      'http://fuseki:3030/data-alice/data',
      expect.objectContaining({ method: 'POST' })
    )

    // indexes: by id (one per record), webId, podUrl
    const indexKeys = Object.keys(state.inserted).filter((key) =>
      key.startsWith('accounts/index/sparqlEndpoint/')
    )
    expect(indexKeys).toContain(`accounts/index/sparqlEndpoint/${registryRecord.id}`)
    expect(indexKeys).toContain(`accounts/index/sparqlEndpoint/${dataRecord.id}`)
    expect(indexKeys).toContain(
      `accounts/index/sparqlEndpoint/webId/${encodeURIComponent('https://alice.id')}`
    )
    expect(indexKeys).toContain(
      `accounts/index/sparqlEndpoint/podUrl/${encodeURIComponent('https://registry/alice/')}`
    )
    expect(indexKeys).toContain(
      `accounts/index/sparqlEndpoint/podUrl/${encodeURIComponent('https://alice.data/')}`
    )
    for (const key of indexKeys) {
      expect(JSON.parse(state.inserted[key])).toEqual(['acc-1'])
    }
  })
})
