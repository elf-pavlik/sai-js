import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

// ──────────────────────────
// Mocks
// ──────────────────────────

/** The Postgres pool is never really opened here. */
vi.mock('postgres', () => ({ default: () => ({}) }))

const temporalMock = vi.hoisted(() => ({
  init: vi.fn(async () => undefined),
  start: vi.fn(async () => ({ workflowId: 'wf' })),
}))
vi.mock('../src/temporal/client.js', () => ({
  Temporal: class {
    client = { workflow: { start: temporalMock.start } }
    init = temporalMock.init
  },
}))
vi.mock('../src/temporal/workflows/account.js', () => ({ bootstrapAccount: 'bootstrapAccount' }))

const storeMock = vi.hoisted(() => ({
  findSparqlByPodUrl: vi.fn(),
  findObjectByPodUrl: vi.fn(),
  createSparql: vi.fn(),
  createObject: vi.fn(),
}))
vi.mock('../src/SessionManager.js', () => ({ getSharedEndpointStore: async () => storeMock }))

const garageMock = vi.hoisted(() => ({
  findBucketByAlias: vi.fn(),
  createBucket: vi.fn(),
  findKeyByName: vi.fn(),
  createKey: vi.fn(),
  allowBucketKey: vi.fn(),
  deleteKey: vi.fn(),
  deleteBucket: vi.fn(),
}))
vi.mock('../src/GarageAdminClient.js', () => ({
  GarageAdminClient: class {
    findBucketByAlias = garageMock.findBucketByAlias
    createBucket = garageMock.createBucket
    findKeyByName = garageMock.findKeyByName
    createKey = garageMock.createKey
    allowBucketKey = garageMock.allowBucketKey
    deleteKey = garageMock.deleteKey
    deleteBucket = garageMock.deleteBucket
  },
}))

import { AccountService } from '../src/services/Account.js'
import { createObjectBucket, writeEndpointRecords } from '../src/temporal/activities/account.js'
import type {
  BootstrapAccountInput,
  ObjectCredentials,
} from '../src/temporal/activities/account.js'
import { agentId, issuanceUrl } from '../src/util/uriTemplates.js'

process.env.CSS_BASE_URL = 'https://auth/'
process.env.CSS_FUSEKI_BASE_URL = 'http://fuseki:3030'
process.env.CSS_S3_ENDPOINT = 'http://garage:3900'
process.env.CSS_GARAGE_ADMIN_ENDPOINT = 'http://garage:3903'
process.env.CSS_GARAGE_ADMIN_TOKEN = 'admin-token'

const input: BootstrapAccountInput = {
  accountId: 'acc-1',
  handle: 'alice',
  webId: 'https://alice.id',
  docId: 'https://id/alice',
  uas: agentId('https://alice.id'),
  issuance: issuanceUrl('https://alice.id'),
  issuer: 'https://auth/',
  registrySet: 'https://registry/alice/',
  dataRegistry: 'https://alice.data/',
}

const credentials: ObjectCredentials = {
  endpoint: 'http://garage:3900',
  bucket: 'data-alice',
  accessKeyId: 'GK1',
  secretAccessKey: 'sk1',
}

afterEach(() => {
  vi.clearAllMocks()
})

// ──────────────────────────
// AccountService.startBootstrapAccount
// ──────────────────────────

describe('AccountService.startBootstrapAccount', () => {
  const service = new AccountService(
    'postgres://temporal:temporal@postgresql:5432/auth',
    'key_value',
    'https://auth/',
    'id',
    'id',
    'data',
    'registry'
  )

  test('derives the IRIs and starts the bootstrap workflow, returning the WebID', async () => {
    const webId = await service.startBootstrapAccount('acc-1', 'alice')

    expect(webId).toBe('https://alice.id')
    expect(temporalMock.start).toHaveBeenCalledWith('bootstrapAccount', {
      taskQueue: 'create-grants',
      workflowId: 'account-bootstrap:acc-1',
      args: [input],
    })
  })
})

// ──────────────────────────
// writeEndpointRecords
// ──────────────────────────

describe('writeEndpointRecords', () => {
  beforeEach(() => {
    storeMock.findSparqlByPodUrl.mockResolvedValue(undefined)
    storeMock.findObjectByPodUrl.mockResolvedValue(undefined)
  })

  test('writes a SPARQL endpoint per pod and the data pod object endpoint', async () => {
    await writeEndpointRecords(input, credentials)

    expect(storeMock.createSparql).toHaveBeenCalledWith({
      accountId: 'acc-1',
      podUrl: 'https://registry/alice/',
      endpoint: 'http://fuseki:3030/reg-alice/sparql',
    })
    expect(storeMock.createSparql).toHaveBeenCalledWith({
      accountId: 'acc-1',
      podUrl: 'https://alice.data/',
      endpoint: 'http://fuseki:3030/data-alice/sparql',
    })
    expect(storeMock.createObject).toHaveBeenCalledWith({
      accountId: 'acc-1',
      podUrl: 'https://alice.data/',
      ...credentials,
    })
  })

  test('is find-first per pod — an existing record is not recreated', async () => {
    storeMock.findSparqlByPodUrl.mockResolvedValue({ id: 'existing' })
    storeMock.findObjectByPodUrl.mockResolvedValue({ id: 'existing' })

    await writeEndpointRecords(input, credentials)

    expect(storeMock.createSparql).not.toHaveBeenCalled()
    expect(storeMock.createObject).not.toHaveBeenCalled()
  })
})

// ──────────────────────────
// createObjectBucket
// ──────────────────────────

describe('createObjectBucket', () => {
  beforeEach(() => {
    storeMock.findObjectByPodUrl.mockResolvedValue(undefined)
    garageMock.findBucketByAlias.mockResolvedValue(undefined)
    garageMock.createBucket.mockResolvedValue({ id: 'b1', globalAliases: ['data-alice'] })
    garageMock.findKeyByName.mockResolvedValue(undefined)
    garageMock.createKey.mockResolvedValue({ accessKeyId: 'GK1', secretAccessKey: 'sk1' })
    garageMock.allowBucketKey.mockResolvedValue({})
  })

  test('provisions a bucket + scoped key and returns the credentials', async () => {
    const result = await createObjectBucket(input)

    expect(result).toEqual(credentials)
    expect(garageMock.createKey).toHaveBeenCalledWith('data-alice')
    expect(garageMock.allowBucketKey).toHaveBeenCalledWith('b1', 'GK1', {
      read: true,
      write: true,
      owner: true,
    })
  })

  test('replaces an existing key with the pod name (a secret is only readable at creation)', async () => {
    garageMock.findKeyByName.mockResolvedValue({ accessKeyId: 'OLD' })

    await createObjectBucket(input)

    expect(garageMock.deleteKey).toHaveBeenCalledWith('OLD')
    expect(garageMock.createKey).toHaveBeenCalled()
  })

  test('reuses the endpoint record when it already exists (no Garage calls)', async () => {
    storeMock.findObjectByPodUrl.mockResolvedValue(credentials)

    const result = await createObjectBucket(input)

    expect(result).toEqual(credentials)
    expect(garageMock.createBucket).not.toHaveBeenCalled()
    expect(garageMock.findBucketByAlias).not.toHaveBeenCalled()
  })
})
