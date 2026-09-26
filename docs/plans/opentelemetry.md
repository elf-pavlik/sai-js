# OpenTelemetry end-to-end tracing (test/CI only, file dump)

> **Status: implemented (M1–M4)** — `docs/plans/opentelemetry.md` §7 M1–M4
> are in the tree: gated bootstrap + NDJSON exporter
> (`packages/components/src/tracing/`), test-runner + worker + Temporal plugin
> wiring, `.dagger` `otelDump` (shared cache volume), and the OTLP/JSON
> converter (`scripts/traces-to-otlp.mjs`, POSTable to Jaeger v2 `:4318`). M5 items (manual RPC span, server-side spans
> on data/registry/id, live Jaeger in compose) remain optional.
> No `.c4` changes: the `authorization-data-app` dynamic view
> (`docs/temporal.c4`) stays the source of truth; telemetry is a runtime
> overlay that maps each view step onto spans.
>
> Reference sample: `temporalio/samples-typescript/interceptors-opentelemetry`
> (the `@temporalio/interceptors-opentelemetry-v2` plugin is taken from
> there verbatim).

## 1. Goal

Collect **one distributed trace per interaction** spanning the whole
`authorization-data-app` dynamic view, using `@opentelemetry/sdk-node`, in the
test environment only (`.dagger` runs; dev `docker-compose` optionally).
Production gets **telemetry off by construction** (no env vars → no-op, §4.2).

| Diagram step (`docs/temporal.c4`) | Span (process) |
|---|---|
| `App.UI -> Alice.AUI 'redirect'` | no HTTP hop — the test runner *is* the browser; modeled as the test-scope root span (`sai-test`) |
| `Alice.AUI -> Alice.UAS.UiApi 'POST (RPC) getAuthorizationData'` | `POST /.sai/api` client span (`sai-test`) → server span (`sai-uas`), joined by the W3C `traceparent` header |
| `… -> App.CID 'GET discover access needs'` | client span `GET …/test-client/public/id` (undici, automatic) |
| `… -> Alice.Data 'find relevant data registrations [Data]'` | client span `POST http://sparql/sparql` — data registrations SPARQL (undici, automatic) |
| `… -> Alice.Registry 'find relevant grants … [Grant]'` | client span `POST http://sparql/sparql` — grants SPARQL (undici, automatic) |
| `… -> App.CID 'GET access needs descriptions'` | client spans for access-need description docs (undici, automatic) |
| `… -> Common.Shapetrees 'GET shapetrees descriptions'` | client span(s) to `…/shapetrees/…` (undici, automatic) |
| `… -> Alice.AUI 'OK authorization data'` | server span end (response) |

Spans beyond this view (invitation/authorization/add-role flows, `docs/plans/activity-first-services.md`) are the same machinery: the UAS-side fan-out + the Temporal gRPC/workflow hop via the plugin (§4.4).

## 2. Scope (what we instrument)

| Process | Instrument? | Hook point |
|---|---|---|
| Test runner (`test/`, vitest) | ✅ | `test/setup.ts` |
| Auth / UAS (`packages/components`, runs *inside* CSS server-factory) | ✅ | `node --import` preload — CSS has no app entrypoint |
| Temporal worker (`packages/components/src/workers/main.ts`) | ✅ | top-of-file import (entry ships for consumers; env-gated, §4.2) |
| `packages/authorization-agent` | ⏸️ phase 2 only | not needed in phase 1 — its fetches are the same global `fetch` the UAS instrumentation covers |
| data / registry / id CSS servers | ❌ phase 1 | hops appear as client spans from the UAS; phase 2 = same preload trick for server-side spans |

Instrumentation surface verified:

- **All UAS outgoing HTTP goes through global `fetch`** (undici, Node 22/24):
  `SelfIssuedSession`/`SessionCore` (`oauth/login`, `authFetch`),
  `fetch-sparql-endpoint` (SPARQL), `services/peerProxy.ts`, webhook
  deliveries, `ActivityEvents`. → one `undici` instrumentation covers every
  hop.
- **CSS inbound** is node `http`/`https` (`server-factory/http.json`) →
  `http` instrumentation covers incoming server spans and propagates the
  trace from the request's `traceparent` header.

## 3. Constraints

1. **No telemetry data in payloads** — OTel correlation rides exclusively on
   the W3C `traceparent` HTTP header. The `traceId`/`spanId`/`sampled` fields
   in the @effect/rpc envelope (`test/util.ts` `rpcPayload`, `Rpc.ts` schema,
   consumed by `RpcRouter` server-side) are **protocol-mandated** — left
   untouched, no new telemetry added to any body.
2. **Temporal hop is headers too** — the plugin propagates context Client →
   Workflow → Child Workflow → Activities via Temporal's internal task
   headers, not workflow args/returns.
3. **Test/CI only** — single env gate `OTEL_TRACES_FILE`, set solely by
   `.dagger`/`docker-compose` (§4.2). No collector runs during a test run
   (§5).
4. **No Jaeger in the dagger graph** — spans land in an NDJSON file dump that
   is exported and viewed offline (§5).

## 4. Design

### 4.1 Dependencies

Runtime deps of `@elfpavlik/sai-components` (the bootstrap module ships in
the published package; `sai-test` already depends on components, so the test
runner gets them transitively). Match the samples-typescript version family —
sdk-node `0.220` / core `2.x` line:

```jsonc
// packages/components/package.json → dependencies
"@opentelemetry/api": "^2",                       // manual spans (no-op without SDK)
"@opentelemetry/core": "^2.9.0",
"@opentelemetry/resources": "^2.9.0",
"@opentelemetry/sdk-node": "^0.220.0",
"@opentelemetry/sdk-trace-base": "^2.9.0",        // SimpleSpanProcessor / ReadableSpan
"@opentelemetry/instrumentation-http": "^0.220.0",
"@opentelemetry/instrumentation-undici": "^0.220.0",
"@temporalio/client": "^1.24.0",                  // bump from ^1.13.0 — plugin needs ≥ 1.19
"@temporalio/common": "^1.24.0",
"@temporalio/worker": "^1.24.0",
"@temporalio/workflow": "^1.24.0",
"@temporalio/interceptors-opentelemetry-v2": "^1.24.0"
// future/optional: "@opentelemetry/exporter-trace-otlp-http": "^0.220.0"
```

Keep all `@opentelemetry/*` on the same version line. Temporal server
version is independent (dagger pins `TEMPORAL_VERSION 1.31.0` — fine).

### 4.2 Bootstrap — env-gated, zero-cost when disabled

New `packages/components/src/tracing/`:

```
tracing/
  bootstrap.ts        # initNodeTracing(serviceName) → NodeSDK | undefined
  preload.ts          # side-effect bootstrap for CSS `node --import`
  ndjson-exporter.ts  # NdjsonSpanExporter (JSON-lines filesystem dump)
```

```ts
// bootstrap.ts — the ENTIRE gate is one non-standard variable
export async function initNodeTracing(serviceName: string) {
  const dumpFile = process.env.OTEL_TRACES_FILE   // set ONLY by .dagger / docker-compose
  if (!dumpFile) return undefined                 // production: nothing set ⇒ no-op
  const [{ NodeSDK }, { HttpInstrumentation }, { UndiciInstrumentation }] =
    await Promise.all([
      import('@opentelemetry/sdk-node'),
      import('@opentelemetry/instrumentation-http'),
      import('@opentelemetry/instrumentation-undici'),
    ])
  const resource = resourceFromAttributes({ [ATTR_SERVICE_NAME]: serviceName })
  const spanProcessor = new SimpleSpanProcessor(new NdjsonSpanExporter(dumpFile))
  const sdk = new NodeSDK({
    resource,
    spanProcessors: [spanProcessor],              // NOT traceExporter — plugin needs the processor
    instrumentations: [
      new HttpInstrumentation(),                  // CSS inbound server spans
      new UndiciInstrumentation({
        // optional: ignoreRequestHook → skip long-lived streams (GET /.sai/events)
      }),
    ],
  })
  sdk.start()
  return sdk
}
```

Why this shape:

- **Dynamic `import()` after the gate** — production never loads OTel code:
  zero startup cost, no `http`/`undici` patching. Deps still ship in the
  published package but are never executed at module load.
- **`SimpleSpanProcessor`, not batch** — synchronous append per span. Batch
  buffers for ~5s and dagger tears the auth/worker services down right after
  the test exec; buffered tail spans would be lost (§5 gotcha).
- **Manual `@opentelemetry/api` spans are prod-safe** — the OTel API is a
  no-op until an SDK starts, so even shipped manual spans do nothing without
  the gate.
- Deferred, **not built now**: `OTEL_SDK_DISABLED` escape hatch — only needed
  the day OTLP export (`OTEL_EXPORTER_OTLP_ENDPOINT`, a *standard* var that
  infra may set globally on every container) joins the gate; at that point
  honor it as the standard hard-off.

`ndjson-exporter.ts` — one line per span, merged across processes by
`traceId`:

```ts
export class NdjsonSpanExporter implements SpanExporter {
  constructor(private readonly path: string) {}
  export(spans: ReadableSpan[], resultCallback: (result: ExportResult) => void): void {
    for (const s of spans) {
      appendFileSync(this.path, JSON.stringify({
        traceId: s.spanContext().traceId, spanId: s.spanContext().spanId,
        parentSpanId: s.parentSpanId, name: s.name, kind: s.kind,
        startTime: s.startTime, endTime: s.endTime, duration: s.duration,
        attributes: s.attributes, events: s.events, status: s.status,
        serviceName: s.resource.attributes['service.name'],
      }) + '\n')
    }
    resultCallback({ code: ExportResultCode.SUCCESS })
  }
  async shutdown(): Promise<void> {}
}
```

`preload.ts`: `initNodeTracing(process.env.OTEL_SERVICE_NAME ?? 'sai-uas')`
— pure side effect; a no-op without `OTEL_TRACES_FILE`.

### 4.3 UAS wiring

- **CSS servers** (docker-compose + dagger `authService()`): add
  `node --require /sai/packages/components/src/tracing/preload.cjs` to the
  CSS command + `OTEL_TRACES_FILE`/`OTEL_SERVICE_NAME` env. The preload is
  **CJS and synchronous on purpose**: `--require` runs before the main
  module (while `--import`/TLA never reliably does — Node ≥ 22.12
  `shouldWaitForPreloadModules` defaults to false), so the http
  `Server.prototype.emit` patch is in place before CSS builds its server.
  CSS's entry (`bin/server.js`) is CJS, so it uses the same patched `http`
  instance.
- **`packages/components/src/workers/main.ts`**: first lines
  `const otelSdk = await initNodeTracing('sai-worker')`; add
  `await otelSdk?.shutdown()` in the existing `finally` block.
- **`packages/components/src/ApiHandler.ts`** (optional, recommended):
  manual span around `handle()` with `sai.rpc.method` / account / webId
  attributes — this names the diagram's key step. `services/Authorization.ts`
  `getDescriptions` needs no manual spans (the client spans already carry
  `http.url`).

### 4.4 Temporal wiring (`@temporalio/interceptors-opentelemetry-v2`)

The **official plugin** replaces any hand-rolled interceptors. It registers
sinks/interceptors on Worker and Client and propagates context (via Temporal
headers) Client → Workflow → Child Workflow → Activities.

**`temporal/client.ts`** — the `Temporal` class used by the webhook receivers
in the **auth** process (this is the hop that joins the UAS trace to the
workflow):

```ts
import { OpenTelemetryPlugin } from '@temporalio/interceptors-opentelemetry-v2'
// auth-process resource + spanProcessor come from tracing/bootstrap.ts
this.client = new Client({ connection: this.#connection, plugins: [new OpenTelemetryPlugin({ resource, spanProcessor })] })
```

**`workers/main.ts`** — same plugin on each of the three `Worker.create`
calls; do NOT rely on `telemetryOptions.tracing` (deprecated in the SDK —
"Core SDK tracing is no longer supported"):

```ts
const plugins = [new OpenTelemetryPlugin({ resource, spanProcessor })]
// Worker.create({ ..., plugins })  ×3  (forward-to-push, reciprocal-registration, create-grants)
```

- Requires `resource` + `spanProcessors` on the NodeSDK (not the
  `traceExporter` shorthand) — §4.2 already does this.
- Our workers use `workflowsPath` (no `bundleWorkflowCode`), so the plugin's
  extra `bundleWorkflowCode({ plugins })` requirement does not apply.
- **Metrics skipped entirely** — the sample's Runtime `telemetryOptions.metrics`
  is OTLP/gRPC-only and irrelevant to tracing; we ship no metric reader.
- Expected shape in the dump: one `traceId` from the auth-process
  `sai-uas` span → `RunWorkflow:*` (worker) → `StartActivity:*` /
  `RunActivity:*` (worker), all under the UAS span that called
  `client.workflow.start`.

### 4.5 Deployment — `.dagger` (cache volume for the dump)

Service filesystems are **not addressable** from a detached exec container
(`container.file()` cannot reach into a service), so the curl-from-service
pattern used e.g. for the sparql dump does not transfer directly. Instead all
three processes share one mutable cache volume:

```ts
const OTEL_CACHE = 'sai-otel-dump'                  // dag.cacheVolume(OTEL_CACHE)

// authService() and workerService(): add
//   .withMountedCache('/otel', dag.cacheVolume(OTEL_CACHE))
//   .withEnvVariable('OTEL_TRACES_FILE', '/otel/auth.ndjson')   // worker → '/otel/worker.ndjson'

@func()
async otelDump(testFile?: string): Promise<Directory> {
  // cache persists across sessions — wipe previous run
  await dag.container().from('alpine:latest')
    .withMountedCache('/otel', dag.cacheVolume(OTEL_CACHE))
    .withExec(['sh', '-c', 'rm -f /otel/*.ndjson']).sync()

  const args = ['npm', 'run', 'dagger:test', ...(testFile ? testFile.split(/\s+/) : [])]
  const result = await (await this.testBase())        // test container: same mount + 'test.ndjson'
    .withExec(args).sync()

  return result
    .withExec(['sh', '-c', 'while [ -z "$(ls -A /otel 2>/dev/null)" ]; do sleep 1; done'])
    .directory('/otel')
}
```

Caller: `dagger call otelDump --testFile="authorization.test.ts" export --path ./otel-dump`.
Returning a `Directory` keeps the per-process files (`auth.ndjson`,
`worker.ndjson`, `test.ndjson`) for the host-side converter (§5). vitest runs
`--no-file-parallelism` (single fork), so the test file is a single process.

`docker-compose.yaml` (dev, optional): same `--import` + env; a `jaeger`
service may be added here later for interactive dev (persistent env, unlike
the ephemeral dagger graph — §5 option B).

## 5. Dump → offline viewer (no collector in the run)

Run (dagger):

```bash
dagger call otel-dump --testFile="authorization.test.ts" export --path ./otel-dump
node scripts/traces-to-otlp.mjs ./otel-dump > otel.json
curl -X POST http://localhost:4318/v1/traces \
  -H 'Content-Type: application/json' \
  --data-binary @otel.json
# then: http://localhost:16686 (Jaeger v2 UI)
```

1. **Jaeger v2 OTLP/HTTP ingest.** `scripts/traces-to-otlp.mjs` merges the
   NDJSON files by `service.name` into an OTLP/JSON `ExportTraceServiceRequest`
   and POSTs it to the Jaeger collector's `:4318/v1/traces` with
   `Content-Type: application/json` (or pipe: `… | curl -X POST … --data-binary @-`).
   NOTE: the dumps' HEX traceId/spanId/parentSpanId are passed through —
   Jaeger v2's OTLP/JSON decoder reads them as hex (base64 gets
   `ID.UnmarshalJSONIter: length mismatch`); a strictly-spec OTLP endpoint
   would need base64.

2. **Optional host-side Jaeger** (nicer UX: search, service graph), run
   outside the graph:
   `docker run -d --name jaeger -p 16686:16686 -p 9411:9411 jaegertracing/all-in-one:latest`
   — replay script converts NDJSON → Zipkin JSON and POSTs to
   `http://localhost:9411/api/v2/spans`.

3. **OTLP env stays for the future** (`OTEL_EXPORTER_OTLP_ENDPOINT` →
   `OTLPTraceExporter`) — for a hosted Tempo/OTel collector or the compose
   dev loop. Bootstrap switches on env; revisit `OTEL_SDK_DISABLED` at that
   point (§4.2).

**Flush gotcha (locked):** `SimpleSpanProcessor` is mandatory for the dump —
dagger kills the bound services as soon as `otelDump` materializes; batch
buffers would lose the workers'/auth's tail spans.

## 6. Production behavior

- `@elfpavlik/sai-components` ships the bootstrap; **no env var ⇒ no-op**.
  `OTEL_TRACES_FILE` is our var — nothing consumers/infra set in production,
  so inherited env cannot switch telemetry on (unlike standard vars).
- The worker entry `dist/workers/main.js` is shipped; gated the same way.
- Manual `@opentelemetry/api` spans are inert without a started SDK.
- Tradeoff accepted: OTel deps ride in `dependencies` of the published
  package but are never loaded/executed when disabled (dynamic import after
  the gate). Alternative (optional peer deps) rejected for simplicity at
  rc-stage.

## 7. Milestones

1. ✅ Deps + `tracing/` bootstrap (gate, `NdjsonSpanExporter`,
   `SimpleSpanProcessor`), console/NDJSON verification without dagger.
2. ✅ `test/setup.ts` + `workers/main.ts` wiring; verified spans.
3. ✅ `otelDump()` dagger func (cache volume + cleanup + `Directory` return) +
   `scripts/traces-to-otlp.mjs`; verified waterfall in a Jaeger v2 container
   via the `:4318/v1/traces` OTLP/HTTP POST.
4. ✅ Temporal: `@temporalio/*` bumped to `^1.24.0`,
   `@temporalio/interceptors-opentelemetry-v2` wired on the three workers +
   `temporal/client.ts`, `shutdown()` in `finally`.
5. ⬜ Optional: `sai-test` root spans per test file; `ApiHandler` RPC span;
   server-side spans on data/registry/id; live Jaeger for the compose dev
   loop.
6. ⬜ **Follow-up: Effect OpenTelemetry bridge for the RPC.** Add
   `@effect/opentelemetry@0.60.0` (peers `effect ^3.19.13` — repo is on
   3.19.16; the latest line needs `effect ^3.22` and an effect bump). Wire
   `EffectTracerProvider` into `ApiHandler.handle()` behind the existing
   gate, sharing `resource`/`spanProcessor` via the `otel-state.ts` holder
   (same one the Temporal plugin uses), so each RPC method's Effect program
   (`SaiService` / `RpcRouter`) emits real OTel spans — automatic
   per-method semantics incl. `Effect.fail` → ERROR + events, nested under
   the manual `sai.rpc.handle` outer span (which keeps our
   `sai.webid`/`sai.account` attributes). Optionally use
   `@effect/opentelemetry/Propagation` so the envelope's protocol-mandated
   `traceId`/`spanId` carry the real OTel trace context instead of
   placeholders.

## 8. Open items

- Keep the @effect/rpc envelope `traceId`/`spanId` placeholders as-is
  (protocol contract) — confirmed.
- If the auth process ever outlives a run in dagger (long-lived dev
  services), add a periodic flush or keep `SimpleSpanProcessor`.
- Decide later whether `ignoreRequestHook` should skip the long-lived
  `GET /.sai/events` stream spans.