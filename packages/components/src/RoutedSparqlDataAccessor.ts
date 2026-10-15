import type { Readable } from 'node:stream'

import { SparqlDataAccessor } from '@solid/community-server'
import type {
  DataAccessor,
  Guarded,
  IdentifierStrategy,
  Representation,
  RepresentationMetadata,
  ResourceIdentifier,
  StorageLocationStrategy,
} from '@solid/community-server'

import type { SparqlEndpointStore } from './SparqlEndpointStore.js'

/**
 * Routes LDP reads/writes to the SPARQL dataset of the resource's pod
 * (docs/plans/fuseki-per-pod-sparql.md stage 3).
 *
 * `StorageLocationStrategy.getStorageIdentifier` yields the pod base URL for
 * both server shapes: a subdomain pod on the data server, the first container
 * on the path-based registry server. The pod URL is the endpoint registry's
 * key, so a single `findByPodUrl` resolves the dataset; unmatched identifiers
 * (the shared root, WebID profiles, …) fall back to the env endpoint.
 *
 * Delegates to a cached {@link SparqlDataAccessor} per endpoint.
 */
export class RoutedSparqlDataAccessor implements DataAccessor {
  private readonly accessors = new Map<string, SparqlDataAccessor>()

  public constructor(
    private readonly endpoint: string,
    private readonly identifierStrategy: IdentifierStrategy,
    private readonly storageStrategy: StorageLocationStrategy,
    private readonly endpointStore: SparqlEndpointStore
  ) {}

  private accessorFor(endpoint: string): SparqlDataAccessor {
    let accessor = this.accessors.get(endpoint)
    if (!accessor) {
      accessor = new SparqlDataAccessor(endpoint, this.identifierStrategy)
      this.accessors.set(endpoint, accessor)
    }
    return accessor
  }

  private async endpointFor(identifier: ResourceIdentifier): Promise<string> {
    try {
      const storage = await this.storageStrategy.getStorageIdentifier(identifier)
      const record = await this.endpointStore.findByPodUrl(storage.path)
      return record?.endpoint ?? this.endpoint
    } catch {
      // no storage (e.g. the root container) — the shared/fallback endpoint
      return this.endpoint
    }
  }

  public async canHandle(representation: Representation): Promise<void> {
    return this.accessorFor(this.endpoint).canHandle(representation)
  }

  public async getData(identifier: ResourceIdentifier): Promise<Guarded<Readable>> {
    return this.accessorFor(await this.endpointFor(identifier)).getData(identifier)
  }

  public async getMetadata(identifier: ResourceIdentifier): Promise<RepresentationMetadata> {
    return this.accessorFor(await this.endpointFor(identifier)).getMetadata(identifier)
  }

  public async *getChildren(
    identifier: ResourceIdentifier
  ): AsyncIterableIterator<RepresentationMetadata> {
    yield* this.accessorFor(await this.endpointFor(identifier)).getChildren(identifier)
  }

  public async writeDocument(
    identifier: ResourceIdentifier,
    data: Guarded<Readable>,
    metadata: RepresentationMetadata
  ): Promise<void> {
    return this.accessorFor(await this.endpointFor(identifier)).writeDocument(
      identifier,
      data,
      metadata
    )
  }

  public async writeContainer(
    identifier: ResourceIdentifier,
    metadata: RepresentationMetadata
  ): Promise<void> {
    return this.accessorFor(await this.endpointFor(identifier)).writeContainer(identifier, metadata)
  }

  public async writeMetadata(
    identifier: ResourceIdentifier,
    metadata: RepresentationMetadata
  ): Promise<void> {
    return this.accessorFor(await this.endpointFor(identifier)).writeMetadata(identifier, metadata)
  }

  public async deleteResource(identifier: ResourceIdentifier): Promise<void> {
    return this.accessorFor(await this.endpointFor(identifier)).deleteResource(identifier)
  }
}
