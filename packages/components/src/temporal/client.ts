import { Client, Connection } from '@temporalio/client'

// TODO: initialize with CSS
// TODO: make tempral address a config var
export class Temporal {
  #connection?: Connection
  public client?: Client

  public async init() {
    if (!this.#connection) {
      this.#connection = await Connection.connect({ address: process.env.TEMPORAL_ADDRESS })
      this.client = new Client({ connection: this.#connection })
    }
  }
}
