import { serializeTurtle } from '@janeirodigital/interop-utils'
import {
  arrayifyStream,
  BadRequestHttpError,
  BasicRepresentation,
  MethodNotAllowedHttpError,
  OkResponseDescription,
  OperationHttpHandler,
  readableToString,
  UnsupportedMediaTypeHttpError,
} from '@solid/community-server'
import type {
  CredentialsExtractor,
  OperationHttpHandlerInput,
  ResponseDescription,
} from '@solid/community-server'
import { SparqlEndpointFetcher, type IBindings, type IUpdateTypes } from 'fetch-sparql-endpoint'
import { getLoggerFor } from 'global-logger-factory'
import { Store } from 'n3'
import type { SessionManager } from './SessionManager'
import { orgWebIdFromPath, requireOrgAdmin } from './services/adminGate.js'

const SPARQL_QUERY_MEDIA_TYPE = 'application/sparql-query'

/**
 * Serialize one SPARQL binding term into the W3C SPARQL JSON results format
 * (`application/sparql-results+json`).
 */
function termToJson(term: IBindings[string]): Record<string, unknown> {
  switch (term.termType) {
    case 'NamedNode':
      return { type: 'uri', value: term.value }
    case 'BlankNode':
      return { type: 'bnode', value: term.value }
    case 'Literal': {
      if (term.language) {
        return { type: 'literal', value: term.value, 'xml:lang': term.language }
      }
      const literal: Record<string, unknown> = { type: 'literal', value: term.value }
      // omit the implicit xsd:string datatype
      if (term.datatype.value !== 'http://www.w3.org/2001/XMLSchema#string') {
        literal.datatype = term.datatype.value
      }
      return literal
    }
    default:
      return { type: 'literal', value: term.value }
  }
}

/**
 * Query-only SPARQL endpoint for org admins (org-context-sparql.md §2.2).
 *
 * Route `/.sai/sparql-admin/<base64url-org-webid>`, speaking the HTTP
 * `QUERY` method only (safe, read-only — draft-ietf-httpapi-safe-methods-wg;
 * DPoP-verifiable since `@solid/access-token-verifier` 2.1.2 added QUERY to
 * its `REQUEST_METHOD` whitelist). The SPARQL query travels in the request
 * body as `application/sparql-query`; updates (`application/sparql-update`,
 * INSERT/DELETE/…) and other methods are rejected.
 *
 * Gate (shared with `/proxy-admin`: `services/adminGate.ts` — the caller
 * must be an admin of the target org: its social-agent registration held
 * by that org carries a non-empty `hasAdminGrant` marker (403 otherwise).
 * The org itself never uses this endpoint; server-side reads go to the
 * internal endpoint directly.
 *
 * Queries are forwarded to the internal endpoint variable
 * (`urn:solid-server:default:variable:sparqlEndpoint`); SELECT/ASK results
 * come back as `application/sparql-results+json`, CONSTRUCT/DESCRIBE as
 * `text/turtle`.
 */
export class AdminSparqlHandler extends OperationHttpHandler {
  protected readonly logger = getLoggerFor(this)

  private readonly fetcher = new SparqlEndpointFetcher()

  public constructor(
    private readonly credentialsExtractor: CredentialsExtractor,
    private readonly sessionManager: SessionManager,
    private readonly sparqlEndpoint: string
  ) {
    super()
  }

  public async handle({
    operation,
    request,
  }: OperationHttpHandlerInput): Promise<ResponseDescription> {
    // Belt-and-suspenders for the read-only contract (the router already
    // restricts the route to QUERY).
    if (operation.method !== 'QUERY') {
      throw new MethodNotAllowedHttpError(['QUERY'])
    }

    // Gate first — no server-side work is triggered for unauthenticated callers.
    // Target org: base64url-encoded webId in the last path segment (the
    // AgentIdHandler pattern); admin check shared with `/proxy-admin`.
    const orgWebId = orgWebIdFromPath(operation.target.path)
    await requireOrgAdmin(this.sessionManager, this.credentialsExtractor, request, orgWebId)

    // Query-only: require the sparql-query media type and reject updates.
    if (operation.body.metadata.contentType !== SPARQL_QUERY_MEDIA_TYPE) {
      throw new UnsupportedMediaTypeHttpError(
        `expected content type ${SPARQL_QUERY_MEDIA_TYPE}`
      )
    }
    const query = await readableToString(operation.body.data)
    if (!query.trim()) {
      throw new BadRequestHttpError('empty query')
    }

    let updateTypes: 'UNKNOWN' | IUpdateTypes
    try {
      updateTypes = this.fetcher.getUpdateTypes(query)
    } catch {
      throw new BadRequestHttpError('invalid SPARQL query')
    }
    if (updateTypes !== 'UNKNOWN') {
      throw new BadRequestHttpError('this endpoint only accepts queries, not updates')
    }

    let queryType: 'SELECT' | 'ASK' | 'CONSTRUCT' | 'UNKNOWN'
    try {
      queryType = this.fetcher.getQueryType(query)
    } catch {
      throw new BadRequestHttpError('invalid SPARQL query')
    }

    let payload: string
    let mediaType: string
    switch (queryType) {
      case 'SELECT': {
        const bindingsStream = await this.fetcher.fetchBindings(this.sparqlEndpoint, query)
        const bindings = await arrayifyStream<IBindings>(bindingsStream)
        payload = JSON.stringify({
          head: { vars: [...new Set(bindings.flatMap((binding) => Object.keys(binding)))] },
          results: {
            bindings: bindings.map((binding) =>
              Object.fromEntries(
                Object.entries(binding).map(([name, term]) => [name, termToJson(term)])
              )
            ),
          },
        })
        mediaType = 'application/sparql-results+json'
        break
      }
      case 'ASK': {
        const boolean = await this.fetcher.fetchAsk(this.sparqlEndpoint, query)
        payload = JSON.stringify({ head: {}, boolean })
        mediaType = 'application/sparql-results+json'
        break
      }
      case 'CONSTRUCT': {
        const triplesStream = await this.fetcher.fetchTriples(this.sparqlEndpoint, query)
        const store = new Store()
        store.addQuads(await arrayifyStream(triplesStream))
        payload = await serializeTurtle(store)
        mediaType = 'text/turtle'
        break
      }
      default:
        throw new BadRequestHttpError('unsupported query form')
    }

    const representation = new BasicRepresentation(payload, operation.target, mediaType)
    return new OkResponseDescription(representation.metadata, representation.data)
  }
}