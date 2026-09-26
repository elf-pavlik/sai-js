import type { NodeSDK } from '@opentelemetry/sdk-node'
import { setTemporalPluginConfig } from './otel-state.js'

/**
 * Opt-in OpenTelemetry bootstrap (docs/plans/opentelemetry.md).
 *
 * The ENTIRE gate is the absence/presence of `OTEL_TRACES_FILE` — a
 * non-standard variable set only by our own tooling (.dagger otel-dump /
 * docker-compose dev). Nothing a consumer's infrastructure sets can switch
 * telemetry on, so production is off by construction. When the gate is
 * closed, no OpenTelemetry module is ever loaded (all imports below are
 * `import type` / lazy `import()`), so there is zero startup or runtime
 * cost in production.
 *
 * NOTE: this async variant is only used where the caller awaits it before
 * anything network-facing happens (worker main.ts, test/setup.ts). CSS
 * servers MUST use the synchronous CJS preload (`preload.cjs` loaded via
 * `--require`) — `--import`/TLA does not reliably complete instrumentation
 * registration before the main module runs (Node ≥ 22.12
 * `shouldWaitForPreloadModules` defaults to false), so the HTTP server-span
 * hook would race CSS building its server.
 */
export async function initNodeTracing(serviceName: string): Promise<NodeSDK | undefined> {
  const dumpFile = process.env.OTEL_TRACES_FILE
  if (!dumpFile) return undefined

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

    // headers → span attributes (docs/plans/opentelemetry.md §5): the subset
    // the diagram http blocks care about — auth/type headers + the discovery
    // Link. TEST/CI only: cookie/authorization carry real session tokens into
    // the file dump (the .c4 notes already print them); keep this OFF for any
    // OTLP endpoint.
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
    const spanProcessor = new SimpleSpanProcessor(new NdjsonSpanExporter(dumpFile))
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
