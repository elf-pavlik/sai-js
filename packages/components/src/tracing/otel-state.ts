import type { Resource } from '@opentelemetry/resources'
import type { SpanProcessor } from '@opentelemetry/sdk-trace-base'

/**
 * Cross-realm holder for the SDK instances the
 * `@temporalio/interceptors-opentelemetry-v2` plugin must share with the
 * NodeSDK. Stored on `globalThis` under a `Symbol.for` key so BOTH the ESM
 * async bootstrap (worker/test) and the synchronous CJS CSS preload
 * (`preload.cjs` — `--require`-loaded, no shared module graph) can
 * populate/read it.
 */

const KEY: symbol = Symbol.for('sai.otel.temporalPluginConfig')

export interface TemporalPluginConfig {
  resource: Resource
  spanProcessor: SpanProcessor
}

/** OTel inputs for `@temporalio/interceptors-opentelemetry-v2`; undefined when tracing is off. */
export function temporalPluginConfig(): TemporalPluginConfig | undefined {
  return (globalThis as Record<symbol, unknown>)[KEY] as TemporalPluginConfig | undefined
}

/** Set by the tracing bootstrap (async) or the CSS preload (synchronous CJS). */
export function setTemporalPluginConfig(config: TemporalPluginConfig | undefined): void {
  ;(globalThis as Record<symbol, unknown>)[KEY] = config
}
