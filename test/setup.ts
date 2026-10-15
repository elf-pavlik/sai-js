import { readFile } from 'node:fs/promises'

import { initNodeTracing } from '@elfpavlik/sai-components'
import {
  Postgres,
  fixturePodDatasets,
  seedFusekiDataset,
  splitFixtureByPod,
} from '@janeirodigital/interop-test-utils'
import { context, trace } from '@opentelemetry/api'
import type { Context, Span } from '@opentelemetry/api'
import { suppressTracing } from '@opentelemetry/core'
import { S3mini } from 's3mini'
import { afterAll, afterEach, beforeAll, beforeEach } from 'vitest'

// opt-in OpenTelemetry: a no-op unless an OTLP endpoint (SAI_OTLP_ENDPOINT in
// the dagger test env) is set. The test runner plays the browser/App role —
// this process holds the trace roots.
const otelSdk = await initNodeTracing('sai-test')

// seeding/teardown is harness I/O, not part of any interaction — keep it out
// of the traces (iso a no-op when no SDK/instrumentation is active)
const withoutTracing = <T>(fn: () => Promise<T>): Promise<T> =>
  context.with(suppressTracing(context.active()), fn)

// per-test root span: each test gets a named root so client/server children
// nest under it. `context.attach` is not on the public ContextAPI facade in
// @opentelemetry/api 1.9, but the registered context manager
// (AsyncHooksContextManager after SDK start) implements attach/detach —
// reached via the private _getContextManager, guarded for when no SDK runs.
type Scope = unknown
let rootToken: Scope | undefined
let rootSpan: Span | undefined

function attachContext(ctx: Context): Scope | undefined {
  const manager = (
    context as unknown as { _getContextManager(): { attach(c: Context): Scope } | undefined }
  )._getContextManager?.()
  return manager?.attach?.(ctx)
}

function detachContext(scope: Scope | undefined): void {
  if (scope === undefined) return
  const manager = (
    context as unknown as { _getContextManager(): { detach(s: Scope): void } | undefined }
  )._getContextManager?.()
  manager?.detach?.(scope)
}

beforeEach((ctx) => {
  detachContext(rootToken)
  const span = trace.getTracer('sai-test').startSpan(ctx.task?.name ?? 'test')
  rootToken = attachContext(trace.setSpan(context.active(), span))
  rootSpan = span
})

afterEach(() => {
  detachContext(rootToken)
  rootToken = undefined
  rootSpan?.end()
  rootSpan = undefined
})

const connectionString = 'postgres://temporal:temporal@postgresql:5432/auth'
// buildSessionManager()'s lazy per-pod endpoint store reads this env var to
// resolve the session's registry-pod endpoint
process.env.CSS_POSTGRES_CONNECTION_STRING ??= connectionString
const keyValuePath = '../environments/data/kv.json'

const fusekiBaseUrl = 'http://fuseki:3030'
const datasetPath = '../environments/data/registry.trig'

const kvData = JSON.parse(await readFile(keyValuePath, 'utf8'))
const datasetData = await readFile(datasetPath, 'utf8')

// stage 3: one Fuseki dataset per pod. The fixture's registry origin is the
// raw `https://registry/` in the dagger environment.
const accounts = Object.values(kvData).flatMap((value: any) => {
  if (!value || !value['**pod**']) return []
  return [
    {
      webId: (Object.values(value['**webIdLink**'])[0] as any).webId,
      podBaseUrls: Object.values(value['**pod**']).map((pod: any) => pod.baseUrl),
    },
  ]
})
const podDatasets = fixturePodDatasets(accounts, 'https://registry/')
const datasets = await splitFixtureByPod(datasetData, { podDatasets })

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
  // flush the trace root before vitest exits: the root span ends in the very
  // last afterEach, and SimpleSpanProcessor's OTLP export is fire-and-forget
  // (the HTTP POST completes asynchronously). NodeSDK.shutdown() flushes the
  // processors and the exporter awaits its in-flight sends before tearing
  // down (same pattern the worker has, packages/components/src/workers/main.ts).
  // Without it the process exit kills the request and the dump lands without
  // a root span.
  try {
    await otelSdk?.shutdown()
  } catch (err) {
    console.warn('[otel] runner shutdown error:', err)
  }
})
beforeEach(async () => {
  await withoutTracing(async () => {
    await pg.seedKeyValue(kvData)
    for (const [dataset, trig] of datasets) {
      await seedFusekiDataset(`${fusekiBaseUrl}/${dataset}`, trig)
    }
  })
})
