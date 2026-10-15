import {
  ACCOUNT_TYPE,
  Initializer,
  InternalServerError,
  createErrorMessage,
} from '@solid/community-server'
import type { AccountLoginStorage } from '@solid/community-server'
import { getLoggerFor } from 'global-logger-factory'

export const SPARQL_ENDPOINT_STORAGE_TYPE = 'sparqlEndpoint'
export const SPARQL_ENDPOINT_STORAGE_DESCRIPTION = {
  accountId: `id:${ACCOUNT_TYPE}`,
  webId: 'string',
  podUrl: 'string',
  endpoint: 'string',
} as const

export interface SparqlEndpointRecord {
  id: string
  accountId: string
  /** owner (org or personal agent) the pod belongs to */
  webId: string
  /**
   * Base URL of the pod whose dataset the endpoint serves. A registry pod's
   * pod URL is its registry-set IRI (`https://<regOrigin>/<handle>/`); a data
   * pod's is its storage base URL. The registry-set IRI is what
   * `registryId(webId)` derives, so every caller can produce the pod URL.
   */
  podUrl: string
  /** internal SPARQL endpoint for the pod's dataset */
  endpoint: string
}

/**
 * Stores one SPARQL endpoint per pod (registry pod + every data pod) in an
 * {@link AccountLoginStorage}, modelled on {@link ReciprocalWebhookStore} and
 * keyed by **pod URL**. Needs to be initialized before it can be used.
 *
 * Stage 2 of docs/plans/fuseki-per-pod-sparql.md: the records are the per-pod
 * endpoint registry (`isolated-datasets-and-sparql.md` 4a, widened from
 * per-owner to per-pod). Until Stage 3 they all point at the shared dataset,
 * so lookups are a no-op next to the env-var fallback.
 */
export class SparqlEndpointStore extends Initializer {
  private readonly logger = getLoggerFor(this)

  private readonly storage: AccountLoginStorage<{
    [SPARQL_ENDPOINT_STORAGE_TYPE]: typeof SPARQL_ENDPOINT_STORAGE_DESCRIPTION
  }>
  private initialized = false

  // Wrong typings to prevent Components.js typing issues
  public constructor(storage: AccountLoginStorage<Record<string, never>>) {
    super()
    this.storage = storage as unknown as typeof this.storage
  }

  // Initialize the type definitions
  public async handle(): Promise<void> {
    if (this.initialized) {
      return
    }
    try {
      await this.storage.defineType(
        SPARQL_ENDPOINT_STORAGE_TYPE,
        SPARQL_ENDPOINT_STORAGE_DESCRIPTION,
        false
      )
      // accountId is the parent reference and is indexed automatically
      await this.storage.createIndex(SPARQL_ENDPOINT_STORAGE_TYPE, 'webId')
      await this.storage.createIndex(SPARQL_ENDPOINT_STORAGE_TYPE, 'podUrl')
      this.initialized = true
    } catch (cause: unknown) {
      throw new InternalServerError(
        `Error defining SPARQL endpoints in storage: ${createErrorMessage(cause)}`,
        { cause }
      )
    }
  }

  public async create(record: Omit<SparqlEndpointRecord, 'id'>): Promise<void> {
    await this.storage.create(SPARQL_ENDPOINT_STORAGE_TYPE, { ...record })
    this.logger.debug(`Added SPARQL endpoint ${record.endpoint} for pod ${record.podUrl}`)
  }

  public async findByPodUrl(podUrl: string): Promise<SparqlEndpointRecord | undefined> {
    const records = await this.storage.find(SPARQL_ENDPOINT_STORAGE_TYPE, { podUrl })
    return (records as unknown as SparqlEndpointRecord[])[0]
  }

  public async findByWebId(webId: string): Promise<SparqlEndpointRecord[]> {
    const records = await this.storage.find(SPARQL_ENDPOINT_STORAGE_TYPE, { webId })
    return records as unknown as SparqlEndpointRecord[]
  }

  /**
   * The record whose `podUrl` is the longest prefix of `iri` — resolves a
   * registry resource (`https://registry/<owner>/grant/<id>`) to its pod.
   */
  public async findByIri(iri: string): Promise<SparqlEndpointRecord | undefined> {
    if (!iri) return undefined
    let best: SparqlEndpointRecord | undefined
    for await (const entry of this.storage.entries(SPARQL_ENDPOINT_STORAGE_TYPE)) {
      const record = entry as unknown as SparqlEndpointRecord
      if (
        (iri === record.podUrl || iri.startsWith(record.podUrl)) &&
        (!best || record.podUrl.length > best.podUrl.length)
      ) {
        best = record
      }
    }
    return best
  }

  public async delete(id: string): Promise<void> {
    this.logger.debug(`Deleting SPARQL endpoint record ${id}`)
    return this.storage.delete(SPARQL_ENDPOINT_STORAGE_TYPE, id)
  }
}
