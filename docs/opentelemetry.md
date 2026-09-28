# OpenTelemetry in sai-js

Opt-in distributed tracing for the test/CI environment (and the compose dev
loop). One waterfall per interaction spans the test runner (as the
browser/App), the UAS (`auth`), the id/registry/data CSS servers, and the
Temporal worker — W3C `traceparent` over HTTP, Temporal headers over gRPC.
Production is off by construction (no env vars → no-op, zero loaded OTel code).

## Usage

```bash
# collect (dagger test env — NDJSON dump per process, cached volume)
dagger call otel-dump --testFile=invitation.test.ts export --path ./otel-dump
# view (Jaeger v2 container on :16686/:4318)
devbox run jaeger        # converts ./otel-dump → OTLP/JSON → POST :4318/v1/traces
```

## Env contract (each instrumented process)

| Var | Effect |
|---|---|
| `OTEL_TRACES_FILE` | NDJSON file dump (`/otel/<runId>/<service>.ndjson` in dagger; anything else, e.g. dev) — **wins over OTLP** |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | live OTLP/HTTP export (compose dev → the `jaeger` service) when `OTEL_TRACES_FILE` is unset |
| `OTEL_SERVICE_NAME` | span `service.name` (sai-test / sai-uas / sai-id / sai-registry / sai-data / sai-worker) |
| `OTEL_SDK_DISABLED=true` / `OTEL_TRACES_EXPORTER=none` | hard-off |

Precedence is deliberate: the dagger engine injects `OTEL_EXPORTER_OTLP_ENDPOINT`
and `OTEL_TRACES_EXPORTER` into exec containers for its own telemetry, so
prioritizing OTLP would silently ship our spans to their collector.

## Mechanics

- **Instrumentation**: `HttpInstrumentation` (server spans for CSS + node:http
  clients) + `UndiciInstrumentation` (global-fetch clients). `SimpleSpanProcessor`
  (synchronous — no batching, so no tail-span loss when dagger kills services).
- **Headers**: selected request/response headers captured as span attributes
  (`authorization`, `cookie`, `content-type`, `accept`, `if-none-match`,
  `link`, `location`, `vary`) — these can carry real session tokens, so this
  stays test/CI-only, never an OTLP endpoint.
- **Per-test roots** (test runner): a root span named after each vitest test;
  `context.attach` via the private `_getContextManager` (api 1.9 removed
  `attach` from the public facade).
- **RPC**: `ApiHandler` wraps the call in an active `sai.rpc.handle` span
  (`sai.webid`/`sai.account`/`sai.rpc.method`); full payloads on the same
  span — `sai.rpc.request` (all incoming RPC envelopes, captured before the
  envelope trace rewrite so it's the wire payload as received) and
  `sai.rpc.response` (the @effect/rpc response/return value, `Success`/`Failure`
  envelope) — both recording-only (`span.isRecording()`, zero stringify cost
  when tracing is off/un-sampled); the `@effect/rpc` envelope
  `traceId`/`spanId` are rewritten from that span (else Effect spans collapse
  into the envelope pseudo-trace); the Effect bridge
  (`tracing/effect-tracer.ts`) exports @effect/rpc's per-method spans
  (`Rpc.router <Tag>`) with `Effect.fail` → ERROR + event, via `Tracer.layerGlobal`
  (the SDK-registered global provider).
- **JSON-LD payloads** (`packages/utils/src/jsonld.ts` — the
  `@janeirodigital/interop-utils` workspace source): manual spans around the
  uniform fetch/decode/write helpers, so every documented payload lands in
  the dump:
  - `fetchJsonLd` → `sai.jsonld.raw` — the wire document as received
    (expanded/compacted/flattened); the auto HTTP client span nests inside
    as the actual GET
  - `frameDoc` → `sai.jsonld.framed` — the framed node with its embedded
    `@context` stripped (`withoutContext`, the POJO form `frameNode`
    produces) — the decoded payload consumers actually read; appears as a
    sibling of `fetchJsonLd` under the same RPC span
  - `putJsonLd` → `sai.jsonld.framed` (the caller's context-attached POJO,
    `@context` stripped) + `sai.jsonld.expanded` (the actual wire body PUT)
  All carry `sai.jsonld.uri`, are recording-only (`span.isRecording()`), and
  set ERROR + `recordException` on failures. Requires
  `@opentelemetry/api` as a direct dep of `packages/utils`.
- **SPARQL** (`withSparqlTracing` in `packages/authorization-agent/src/sparql.ts`,
  applied to BOTH transports — personal internal endpoint and org
  `/sparql-admin`): every registry-plane read (SELECT/CONSTRUCT) runs inside a
  `sparql.query` span with `sai.sparql.query` (verbatim text),
  `sai.sparql.endpoint`, `sai.sparql.form`, `sai.sparql.resultCount`
  (bindings/triples count — result payloads are not recorded, only counts).
  Recording-only; ERROR + `recordException` on failure. Requires
  `@opentelemetry/api` as a direct dep of `packages/authorization-agent`.
- **Temporal**: `@temporalio/interceptors-opentelemetry-v2` `OpenTelemetryPlugin`
  on the three workers + the client, sharing the same `spanProcessor`
  (holder: `tracing/otel-state.ts`, cross-realm via `Symbol.for`).
- **Noise reduction**: registry/data/id skip their own SPARQL-store client
  spans (`ignoreRequestHook`/`ignoreOutgoingRequestHook`, service-name gated) —
  91% of registry traffic was their own re-queries; `sai-uas` keeps sparql
  spans (the diagrams' `[Data]`/`[Grant]` hops).
- **Dump records** carry `pid` (restart detection) and hex ids; the Jaeger
  OTLP/JSON converter passes ids through as hex (this Jaeger build reads ids
  as hex — base64 gets `ID.UnmarshalJSONIter: length mismatch`).

## Where it lives

New (`packages/components/src/tracing/`): `bootstrap.ts` (async gate/init),
`preload.cjs` (sync CJS CSS preload — `--require`, see header: `--import`
races the main module), `ndjson-exporter.ts`, `otel-state.ts`,
`effect-tracer.ts`. Plus `scripts/traces-to-otlp.mjs`, `scripts/jaeger.sh`.

Added to existing files:

- `packages/components/src/ApiHandler.ts` — `sai.rpc.handle` active span,
  `sai.rpc.request`/`sai.rpc.response` payload capture, envelope trace
  rewrite, `withEffectTracing`
- `packages/utils/src/jsonld.ts` — `fetchJsonLd`/`frameDoc`/`putJsonLd`
  spans with `sai.jsonld.raw`/`sai.jsonld.framed`/`sai.jsonld.expanded`
  payload attributes (`@context` stripped; recording-only)
- `packages/utils/package.json` — `@opentelemetry/api` dep
- `packages/authorization-agent/src/sparql.ts` — `withSparqlTracing` +
  `sparql.query` spans on `localSparqlTransport` (personal context)
- `packages/components/src/services/queries/org.ts` — same wrap on
  `adminSparqlTransport` (org `/sparql-admin`)
- `packages/authorization-agent/package.json` — `@opentelemetry/api` dep
- `packages/components/src/workers/main.ts` — init, Temporal plugin on the 3
  workers, `sdk.shutdown()`
- `packages/components/src/temporal/client.ts` — `OpenTelemetryPlugin` on `Client`
- `packages/components/src/index.ts` — exports `initNodeTracing`
- `packages/components/package.json` — OTel deps, `@temporalio/* ^1.24`,
  `@temporalio/interceptors-opentelemetry-v2`, `@effect/opentelemetry`,
  `@opentelemetry/sdk-trace-web` (peer)
- `test/setup.ts` — init, per-test root spans, seed suppression
  (`suppressTracing`)
- `.dagger/src/index.ts` — per-service env/mount (`/otel` cache volume,
  `OTEL_TRACES_FILE` per run-id dir), `--require` preloads,
  `otelDump()` (run-id isolation — dagger exec-cache made a wipe a no-op)
- `docker-compose.yaml` — `jaeger` service, preloads + `OTEL_EXPORTER_OTLP_ENDPOINT`
  on auth/worker/data/registry/id
- `devbox.json` — `jaeger` script (`bash scripts/jaeger.sh`)