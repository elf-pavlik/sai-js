import { readFileSync } from 'node:fs'
import { type RdfFetch, type WhatwgFetch, fetchWrapper } from '@janeirodigital/interop-utils'
import * as jsonldNs from 'jsonld'
import { Parser, Store } from 'n3'

// CJS/ESM interop: jsonld is a CJS package
const jsonld = (jsonldNs as any).default ?? jsonldNs

const STORAGE_DESCRIPTION_IRI = 'https://fake.example/storage-desription'
const dataFile = new URL('data.json', import.meta.url)
const data = JSON.parse(readFileSync(dataFile, 'utf-8'))

/** Parse Turtle string into expanded JSON-LD array. */
async function turtleToJsonLd(turtle: string, baseIRI: string): Promise<unknown[]> {
  const store = new Store()
  const parser = new Parser({ baseIRI })
  return new Promise((resolve, reject) => {
    parser.parse(turtle, (error: Error, quad) => {
      if (error) {
        reject(error)
      } else if (quad) {
        store.add(quad)
      } else {
        resolve(jsonld.fromRDF(store))
      }
    })
  })
}

async function common(
  url: string,
  options?: RequestInit,
  state?: { [key: string]: string }
): Promise<Response> {
  // handle storage description requests
  if (url === STORAGE_DESCRIPTION_IRI) {
    return {
      clone: () => ({}) as unknown as Response,
      headers: {
        get: () => 'text/turtle',
      },
      text: async () => `<${STORAGE_DESCRIPTION_IRI}> a <http://www.w3.org/ns/pim/space#Storage> .`,
    } as unknown as Response
  }

  // strip fragment
  const strippedUrl = url.replace(/#.*$/, '')
  // Access Accept header via type assertion since RequestInit.headers is HeadersInit
  const accept = (options?.headers as Record<string, string> | undefined)?.Accept
  // If Accept is not set or includes text/turtle, serve Turtle (backward compat).
  // If Accept is exactly application/ld+json, serve JSON-LD.
  const acceptsJsonLd = accept === 'application/ld+json'

  async function getData(): Promise<string> {
    const value = state?.[strippedUrl] ?? data[strippedUrl]
    if (!value) {
      throw new Error(`missing snippet: ${strippedUrl}`)
    }
    return value
  }

  const headers: Record<string, string> = {
    'Content-Type': acceptsJsonLd ? 'application/ld+json' : 'text/turtle',
    Link: `<http://just.en.example/description-resource>; rel="describedby", <${STORAGE_DESCRIPTION_IRI}>; rel="http://www.w3.org/ns/solid/terms#storageDescription`,
  }

  // @ts-ignore
  const response: Response = {
    ok: true,
    headers: {
      get(name: string) {
        if (name in headers) return headers[name]
        throw Error(`${name} not supported`)
      },
    } as Headers,
    text: async () => getData(),
    json: acceptsJsonLd
      ? async () => {
          const turtle = await getData()
          return turtleToJsonLd(turtle, strippedUrl)
        }
      : undefined,
  }
  response.clone = () => ({ ...response })
  return response
}

function addState(state: { [key: string]: string }): WhatwgFetch {
  return async function statefulFetch(url: string, options?: RequestInit): Promise<Response> {
    if (options?.method === 'PUT') {
      state[url] = options.body as string
      const response = { ok: true } as Response
      response.clone = () => ({ ...response })
      return response
    }

    return common(url, options, state)
  } as WhatwgFetch
}

export function createFetch(): RdfFetch {
  const state: { [key: string]: string } = {}
  return fetchWrapper(addState(state))
}

export function createStatefulFetch(): WhatwgFetch {
  const state: { [key: string]: string } = {}
  return addState(state)
}

export const statelessFetch = async function statelessFetch(
  url: string,
  options?: RequestInit
): Promise<Response> {
  // just ok PUT or PATCH
  if (options?.method === 'PUT' || options?.method === 'PATCH') {
    const response = { ok: true } as Response
    response.clone = () => ({ ...response })
    return response
  }
  return common(url, options)
} as WhatwgFetch

export const fetch = fetchWrapper(statelessFetch)
