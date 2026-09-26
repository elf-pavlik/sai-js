import { Client, Connection } from '@temporalio/client'
import { OpenTelemetryPlugin } from '@temporalio/interceptors-opentelemetry-v2'
import { temporalPluginConfig } from '../tracing/otel-state.js'

// TODO: initialize with CSS
// TODO: make tempral address a config var
export class Temporal {
  #connection?: Connection
  public client?: Client

  public async init() {
    if (!this.#connection) {
      this.#connection = await Connection.connect({ address: process.env.TEMPORAL_ADDRESS })
      const config = temporalPluginConfig()
      // joins the auth-process trace to workflows/activities when tracing is on
      const plugins = config ? [new OpenTelemetryPlugin(config)] : []
      this.client = new Client({ connection: this.#connection, plugins })
    }
  }
}
