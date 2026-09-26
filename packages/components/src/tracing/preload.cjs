'use strict'
/**
 * Synchronous CJS side-effect bootstrap for CSS servers (no app-level
 * entrypoint we own). Usage:
 *
 *   node --require /sai/packages/components/src/tracing/preload.cjs <css-server.js>
 *
 * MUST use `--require`, NOT `--import`: --require runs synchronously before
 * the main module, so the http instrumentation patches
 * `http.Server.prototype.emit` before CSS builds its server; --import
 * preloads are not awaited (Node ≥ 22.12) and CJS keeps node 22 (compose
 * auth) happy. Nothing outside our compose/dagger command lines adds this.
 */
const hardDisabled =
  process.env.OTEL_SDK_DISABLED === 'true' || process.env.OTEL_TRACES_EXPORTER === 'none'
const otlpEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT
const dumpFile = process.env.OTEL_TRACES_FILE
if (!hardDisabled && (otlpEndpoint || dumpFile)) {
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
    // SimpleSpanProcessor (NOT batch): dagger kills the service right after
    // the test exec — batch would lose tail spans. Exporter precedence:
    // OTEL_TRACES_FILE (OUR var) wins — the dagger engine injects standard
    // OTLP env (OTEL_EXPORTER_OTLP_ENDPOINT/_TRACES_EXPORTER) into exec
    // containers for its own telemetry; prioritizing it would silently ship
    // our spans to their collector. OTLP is used only when no file var set
    // (compose dev loop -> the jaeger service).
    const spanProcessor = dumpFile
      ? new SimpleSpanProcessor(new NdjsonSpanExporter(dumpFile))
      : new SimpleSpanProcessor(
          new (require('@opentelemetry/exporter-trace-otlp-http').OTLPTraceExporter)()
        )
    // cross-realm holder — read by temporal/client.ts in this same process
    globalThis[Symbol.for('sai.otel.temporalPluginConfig')] = { resource, spanProcessor }

    // registry/data/id re-query the SPARQL store for every operation (91% of
    // sai-registry spans and 50% of sai-id = its own sparql POSTs) — skip
    // those client spans in those processes only; sai-uas keeps them
    // (diagram [Data]/[Grant] hops)
    const skipSparqlStoreSpans = ['sai-registry', 'sai-data', 'sai-id'].includes(
      process.env.OTEL_SERVICE_NAME
    )

    const sdk = new NodeSDK({
      resource,
      spanProcessors: [spanProcessor],
      instrumentations: [
        new HttpInstrumentation({
          headersToSpanAttributes,
          ignoreOutgoingRequestHook: (options) =>
            skipSparqlStoreSpans && `${options.hostname ?? options.host ?? ''}`.includes('sparql'),
        }),
        new UndiciInstrumentation({
          headersToSpanAttributes: { requestHeaders, responseHeaders },
          ignoreRequestHook: (request) => skipSparqlStoreSpans && request.origin.includes('sparql'),
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
