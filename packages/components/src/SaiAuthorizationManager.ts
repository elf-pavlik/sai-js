import type { DatasetCore, Quad } from '@rdfjs/types'
import { NotFoundHttpError, arrayifyStream } from '@solid/community-server'
import type { IdentifierStrategy, StorageLocationStrategy } from '@solid/community-server'
import type { AuthorizationManager } from '@solidlab/policy-engine'
import { type IBindings, SparqlEndpointFetcher } from 'fetch-sparql-endpoint'
import { getLoggerFor } from 'global-logger-factory'
import { INTEROP } from './vocabularies.js'

export class SaiAuthorizationManager implements AuthorizationManager {
  private fetcher: SparqlEndpointFetcher
  private readonly logger = getLoggerFor(this)

  public constructor(
    protected readonly identifierStrategy: IdentifierStrategy,
    private readonly sparqlEndpoint: string,
    protected readonly storageStrategy: StorageLocationStrategy
  ) {
    this.fetcher = new SparqlEndpointFetcher()
  }

  public getParent(id: string): string | undefined {
    const identifier = { path: id }
    return this.identifierStrategy.isRootContainer(identifier)
      ? undefined
      : this.identifierStrategy.getParentContainer(identifier).path
  }

  public async getStorage(id: string): Promise<string> {
    const storage = await this.storageStrategy.getStorageIdentifier({ path: id })
    return storage.path
  }

  public async getAuthorizationData(id: string): Promise<DatasetCore | Quad[] | undefined> {
    const storage = await this.storageStrategy.getStorageIdentifier({ path: id })

    try {
      const bindingsStream = await this.fetcher.fetchBindings(
        this.sparqlEndpoint,
        `
        SELECT * WHERE {
          GRAPH ?g {?s <${INTEROP.hasStorage}> <${storage.path}> }
        }
      `
      )
      const results = await arrayifyStream<IBindings>(bindingsStream)
      // biome-ignore lint/complexity/useLiteralKeys:
      const grants = results.map((b) => b['s'].value)

      let data: Quad[] = []
      for (const grant of grants) {
        const grantsStream = await this.fetcher.fetchTriples(
          this.sparqlEndpoint,
          `
            CONSTRUCT { <${grant}> ?p ?o } WHERE {
              GRAPH ?g { <${grant}> ?p ?o }
            }
          `
        )
        const results = await arrayifyStream<Quad>(grantsStream)
        data = data.concat(results)
      }
      // TODO: add statements about admins/trusted grants
      return data
    } catch (err) {
      if (NotFoundHttpError.isInstance(err)) {
        return
      }
      throw err
    }
  }
}
