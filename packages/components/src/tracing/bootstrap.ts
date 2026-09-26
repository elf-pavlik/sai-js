import type { NodeSDK } from '@opentelemetry/sdk-node'
import type { SpanProcessor } from '@opentelemetry/sdk-trace-base'
import { setTemporalPluginConfig } from './otel-state.js'

/**
 * Opt-in OpenTelemetry bootstrap.
 *
 * Gate: `OTEL_TRACES_FILE` (our NDJSON file dump) wins over the standard
 * OTLP env vars — infra (incl. the dagger engine) sets
 * `OTEL_EXPORTER_OTLP_ENDPOINT`/`OTEL_TRACES_EXPORTER` globally on every
 * container, so prioritizing them would ship our spans into their
 * collector. Hard-off: `OTEL_SDK_DISABLED=true` / `OTEL_TRACES_EXPORTER=none`.
 * When the gate is closed no OpenTelemetry module is loaded (lazy imports).
 *
 * Async variant — only use where the caller awaits it before any network
 * activity (worker main.ts, test/setup.ts). CSS servers must use
 * `preload.cjs` via `--require` (sync): `--import`/TLA does not reliably
 * complete instrumentation registration before the main module runs.
 */
export async function initNodeTracing(serviceName: string): Promise<NodeSDK | undefined> {
  // hard-off: standard escape hatch
  if (process.env.OTEL_SDK_DISABLED === 'true' || process.env.OTEL_TRACES_EXPORTER === 'none') {
    return undefined
  }
  const otlpEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT
  const dumpFile = process.env.OTEL_TRACES_FILE
  if (!otlpEndpoint && !dumpFile) return undefined

  try {
    const [
      { NodeSDK },
      { SimpleSpanProcessor },
      { HttpInstrumentation },
      { UndiciInstrumentation },
      { resourceFromAttributes },
      { ATTR_SERVICE_NAME },
      { NdjsonSpanExporter },
    ] = await Promise.all([
      import('@opentelemetry/sdk-node'),
      import('@opentelemetry/sdk-trace-base'),
      import('@opentelemetry/instrumentation-http'),
      import('@opentelemetry/instrumentation-undici'),
      import('@opentelemetry/resources'),
      import('@opentelemetry/semantic-conventions'),
      import('./ndjson-exporter.js'),
    ])

    const resource = resourceFromAttributes({ [ATTR_SERVICE_NAME]: serviceName })

    // headers → span attributes: the subset the diagram http blocks care
    // about — auth/type headers + the discovery Link. TEST/CI only:
    // cookie/authorization carry real session tokens into the file dump
    // (the .c4 notes already print them); keep this OFF for any OTLP endpoint.
    const requestHeaders = [
      'authorization',
      'cookie',
      'content-type',
      'accept',
      'if-none-match',
      'link',
    ]
    const responseHeaders = ['link', 'content-type', 'location', 'vary']
    const headersToSpanAttributes = {
      client: { requestHeaders, responseHeaders },
      server: { requestHeaders, responseHeaders },
    }

    // SimpleSpanProcessor (NOT batch): dagger tears the bound services down
    // right after the test exec — batch would buffer and lose the tail spans.
    // Exporter precedence: OTEL_TRACES_FILE (OUR var) wins — standard OTLP
    // env is set globally by infra (e.g. the dagger engine's own telemetry
    // injects OTEL_EXPORTER_OTLP_ENDPOINT/_TRACES_EXPORTER into exec
    // containers), so prioritizing it would silently send our spans into
    // their collector. OTLP is used only when no file var is set (compose
    // dev loop -> the jaeger service).
    let spanProcessor: SpanProcessor
    if (dumpFile) {
      spanProcessor = new SimpleSpanProcessor(new NdjsonSpanExporter(dumpFile))
    } else {
      const { OTLPTraceExporter } = await import('@opentelemetry/exporter-trace-otlp-http')
      // endpoint comes from the OTEL_EXPORTER_OTLP_ENDPOINT env var;
      // the exporter appends /v1/traces
      spanProcessor = new SimpleSpanProcessor(new OTLPTraceExporter())
    }
    setTemporalPluginConfig({ resource, spanProcessor })

    const sdk = new NodeSDK({
      // resource + spanProcessors (not the traceExporter shorthand) — the
      // @temporalio/interceptors-opentelemetry-v2 plugin needs the same
      // processor instance to sink Workflow/Activity/Client spans into.
      resource,
      spanProcessors: [spanProcessor],
      instrumentations: [
        new HttpInstrumentation({ headersToSpanAttributes }),
        new UndiciInstrumentation({
          headersToSpanAttributes: { requestHeaders, responseHeaders },
          // optional: skip long-lived streams (GET /.sai/events)
          // ignoreRequestHook: (request) => request.path === '/.sai/events',
        }),
      ],
    })
    sdk.start()
    return sdk
  } catch (err) {
    // fail-soft: telemetry must never break the application
    console.warn(`[otel] failed to start OpenTelemetry for ${serviceName}:`, err)
    return undefined
  }
}
