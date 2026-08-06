import type { DatasetCore } from '@rdfjs/types'
import * as jsonldNs from 'jsonld'
import { parseJsonld, parseTurtle } from '.'

// CJS/ESM interop: jsonld is a CJS package; in the ESM bundle the namespace
// has the full exports only on .default, while named exports like `fromRDF`
// are hoisted. Grab the full object so that `fromRDF` is available.
const jsonld = (jsonldNs as any).default ?? jsonldNs

export interface RdfRequestInit extends RequestInit {
  dataset?: DatasetCore
}

export interface RdfResponse extends Response {
  dataset(): Promise<DatasetCore>
  text(): Promise<string>
}

export type WhatwgFetch = (input: RequestInfo, init?: RequestInit) => Promise<Response>
export type RdfFetch = ((iri: string, options?: RdfRequestInit) => Promise<RdfResponse>) & {
  raw: WhatwgFetch
}

// TODO accept either string | NamedNode
// https://github.com/janeirodigital/sai-js/issues/17
async function unwrappedRdfFetch(
  whatwgFetch: WhatwgFetch,
  iri: string,
  options?: RdfRequestInit
): Promise<RdfResponse> {
  let requestInit: RequestInit
  if (options?.dataset) {
    const { dataset, ...request } = options
    request.body = JSON.stringify(await jsonld.fromRDF(dataset))
    request.headers = { 'Content-Type': 'application/ld+json', ...request.headers }
    requestInit = request
  } else {
    requestInit = { ...options } as RequestInit
    requestInit.headers = { Accept: 'application/ld+json', ...requestInit.headers }
  }
  const response = await whatwgFetch(iri, requestInit)
  const rdfResponse = response.clone() as RdfResponse
  rdfResponse.dataset = async function dataset() {
    const contentType = response.headers.get('Content-Type')
    if (contentType?.includes('application/ld+json')) {
      return parseJsonld(await response.text(), response.url)
    }
    if (contentType?.includes('text/turtle')) {
      return parseTurtle(await response.text(), response.url)
    }
    throw Error(`Content-Type was ${contentType}`)
  }
  rdfResponse.text = response.text
  return rdfResponse
}

export function fetchWrapper(whatwgFetch: WhatwgFetch): RdfFetch {
  const wrappedRdfFetch = function wrappedRdfFetch(iri: string, options?: RdfRequestInit) {
    return unwrappedRdfFetch(whatwgFetch, iri, options)
  }
  wrappedRdfFetch.raw = whatwgFetch
  return wrappedRdfFetch
}
