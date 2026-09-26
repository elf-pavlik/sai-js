import { appendFileSync } from 'node:fs'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import type { HrTime } from '@opentelemetry/api'
import { type ExportResult, ExportResultCode } from '@opentelemetry/core'
import type { ReadableSpan, SpanExporter } from '@opentelemetry/sdk-trace-base'

/** OTel HrTime [seconds, nanoseconds] → epoch milliseconds. */
function hrToMs(hr: HrTime): number {
  return hr[0] * 1000 + hr[1] / 1e6
}

/**
 * JSON-lines file dump — one compact span record per line, appended
 * synchronously. Files from all processes are merged by `traceId` by the
 * offline viewer (`scripts/traces-to-jaeger.mjs`).
 */
export class NdjsonSpanExporter implements SpanExporter {
  private readonly path: string

  public constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true })
    this.path = path
  }

  public export(spans: ReadableSpan[], resultCallback: (result: ExportResult) => void): void {
    for (const span of spans) {
      appendFileSync(
        this.path,
        `${JSON.stringify({
          traceId: span.spanContext().traceId,
          spanId: span.spanContext().spanId,
          parentSpanId: span.parentSpanContext?.spanId,
          name: span.name,
          kind: span.kind,
          startTime: hrToMs(span.startTime),
          endTime: hrToMs(span.endTime),
          duration: hrToMs(span.duration),
          attributes: span.attributes,
          events: span.events,
          status: span.status,
          serviceName: span.resource.attributes['service.name'],
          // restart detection: one writer per process, appended to the same file
          pid: process.pid,
        })}\n`
      )
    }
    resultCallback({ code: ExportResultCode.SUCCESS })
  }

  public async shutdown(): Promise<void> {}
}
