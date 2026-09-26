import { readFile } from 'node:fs/promises'
import { initNodeTracing } from '@elfpavlik/sai-components'
import { Postgres, seedQuadstore } from '@janeirodigital/interop-test-utils'
import { context } from '@opentelemetry/api'
import { suppressTracing } from '@opentelemetry/core'
import { S3mini } from 's3mini'
import { afterAll, beforeAll, beforeEach } from 'vitest'

// opt-in OpenTelemetry (docs/plans/opentelemetry.md): a no-op unless the
// .dagger otel-dump run sets OTEL_TRACES_FILE. The test runner plays the
// browser/App role — this process holds the trace roots.
await initNodeTracing('sai-test')

// seeding/teardown is harness I/O, not part of any interaction — keep it out
// of the traces (iso a no-op when no SDK/instrumentation is active)
const withoutTracing = <T>(fn: () => Promise<T>): Promise<T> =>
  context.with(suppressTracing(context.active()), fn)

const connectionString = 'postgres://temporal:temporal@postgresql:5432/auth'
const keyValuePath = '../environments/data/kv.json'

const sparqlEndpoint = 'http://sparql/store'
const datasetPath = '../environments/data/registry.trig'

const kvData = JSON.parse(await readFile(keyValuePath, 'utf8'))
const datasetData = await readFile(datasetPath, 'utf8')

const clientId = 'https://data/test-client/public/id'
const clientIdPath = '../environments/data/test-client/public/id$.jsonld'

const pg = new Postgres(connectionString, 'key_value')

const clientIdData = await readFile(clientIdPath)
const garage = new S3mini({
  endpoint: process.env.CSS_S3_ENDPOINT ?? 'http://garage:3900/sai-dev',
  accessKeyId: process.env.CSS_S3_ACCESS_KEY_ID ?? 'GKd0656430cbd2bba62e2cc12b',
  secretAccessKey:
    process.env.CSS_S3_SECRET_ACCESS_KEY ??
    'aa3594ca915bf7b310c7672d436f2a937f20d2ad022eec90345dfc364e1bdd4c',
  region: process.env.CSS_S3_REGION ?? 'garage',
})

beforeAll(async () => {
  await withoutTracing(() => garage.putAnyObject(clientId, clientIdData, 'application/ld+json'))
})
afterAll(async () => {
  await withoutTracing(() => garage.deleteObject(clientId))
})
beforeEach(async () => {
  await withoutTracing(async () => {
    await pg.seedKeyValue(kvData)
    await seedQuadstore(sparqlEndpoint, datasetData)
  })
})
