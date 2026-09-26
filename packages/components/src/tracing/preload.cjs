'use strict'
/**
 * Synchronous CJS side-effect bootstrap for CSS servers (docs/plans/
 * opentelemetry.md), which have no app-level entrypoint we own. Usage:
 *
 *   node --require /sai/packages/components/src/tracing/preload.cjs <css-server.js>
 *
 * MUST be loaded with `--require`, NOT `--import`:
 * - `--require` runs synchronously and is guaranteed to complete before the
 *   main module — so the http instrumentation patches
 *   `http.Server.prototype.emit` before CSS builds its server.
 * - `--import` preloads are NOT awaited before the main module (Node ≥ 22.12
 *   `shouldWaitForPreloadModules` defaults to false) — the async bootstrap
 *   races CSS creating its HTTP server, the server-span hook never attaches,
 *   and every auth-side call becomes an orphan client root.
 * - CJS also keeps node 22 (compose auth runs node:22-alpine) happy — no
 *   require(esm) needed.
 *
 * Production is unaffected: nothing outside our docker-compose/.dagger
 * command lines adds this `--require`.
 */
const dumpFile = process.env.OTEL_TRACES_FILE
if (dumpFile) {
  try {
    const { appendFileSync, mkdirSync } = require('node:fs')
    const { dirname } = require('node:path')
    const { HttpInstrumentation } = require('@opentelemetry/instrumentation-http')
    const { UndiciInstrumentation } = require('@opentelemetry/instrumentation-undici')
    const { resourceFromAttributes } = require('@opentelemetry/resources')
    const { NodeSDK } = require('@opentelemetry/sdk-node')
    const { SimpleSpanProcessor } = require('@opentelemetry/sdk-trace-base')
    const { ATTR_SERVICE_NAME } = require('@opentelemetry/semantic-conventions')

    const serviceName = process.env.OTEL_SERVICE_NAME ?? 'sai-uas'

    // JSON-lines dump — one compact span record per line, appended
    // synchronously (SimpleSpanProcessor, NOT batch: dagger kills the
    // service right after the test exec — batch would lose tail spans).
    class NdjsonSpanExporter {
      constructor(path) {
        mkdirSync(dirname(path), { recursive: true })
        this.path = path
      }
      export(spans, resultCallback) {
        for (const span of spans) {
          appendFileSync(
            this.path,
            `${JSON.stringify({
              traceId: span.spanContext().traceId,
              spanId: span.spanContext().spanId,
              parentSpanId: span.parentSpanContext?.spanId,
              name: span.name,
              kind: span.kind,
              startTime: span.startTime[0] * 1000 + span.startTime[1] / 1e6,
              endTime: span.endTime[0] * 1000 + span.endTime[1] / 1e6,
              duration: span.duration[0] * 1000 + span.duration[1] / 1e6,
              attributes: span.attributes,
              events: span.events,
              status: span.status,
              serviceName: span.resource.attributes['service.name'],
              // restart detection: one writer per process, appended to the same file
              pid: process.pid,
            })}\n`
          )
        }
        resultCallback({ code: 0 }) // ExportResultCode.SUCCESS
      }
      shutdown() {}
    }

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
    const spanProcessor = new SimpleSpanProcessor(new NdjsonSpanExporter(dumpFile))
    // cross-realm holder — read by temporal/client.ts in this same process
    globalThis[Symbol.for('sai.otel.temporalPluginConfig')] = { resource, spanProcessor }

    const sdk = new NodeSDK({
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
  } catch (err) {
    // fail-soft: telemetry must never break the application
    console.warn(
      `[otel] failed to start OpenTelemetry for ${process.env.OTEL_SERVICE_NAME ?? 'sai-uas'}:`,
      err
    )
  }
}
