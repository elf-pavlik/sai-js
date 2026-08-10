import { readFileSync } from 'node:fs'
import type { WhatwgFetch } from '@janeirodigital/interop-utils'

const STORAGE_DESCRIPTION_IRI = 'https://fake.example/storage-desription'
const dataFile = new URL('data.json', import.meta.url)
const data = JSON.parse(readFileSync(dataFile, 'utf-8'))

const storageDescriptionJsonLd = JSON.stringify([
  {
    '@id': STORAGE_DESCRIPTION_IRI,
    '@type': ['http://www.w3.org/ns/pim/space#Storage'],
  },
])

async function common(
  url: string,
  options?: RequestInit,
  state?: { [key: string]: string }
): Promise<Response> {
  // handle storage description requests
  if (url === STORAGE_DESCRIPTION_IRI) {
    return {
      ok: true,
      clone: () => ({}) as unknown as Response,
      headers: {
        get: () => 'application/ld+json',
      },
      text: async () => storageDescriptionJsonLd,
      json: async () => JSON.parse(storageDescriptionJsonLd),
    } as unknown as Response
  }

  // strip fragment
  const strippedUrl = url.replace(/#.*$/, '')
  // Access Accept header via type assertion since RequestInit.headers is HeadersInit
  const accept = (options?.headers as Record<string, string> | undefined)?.Accept
  // JSON-LD by default; serve Turtle only for an explicit text/turtle Accept
  // (ACL resources, and any transitional callers that still ask for it).
  const acceptsTurtle = accept === 'text/turtle'

  async function getData(): Promise<string> {
    const value = state?.[strippedUrl] ?? data[strippedUrl]
    if (!value) {
      throw new Error(`missing snippet: ${strippedUrl}`)
    }
    return value
  }

  const headers: Record<string, string> = {
    'Content-Type': acceptsTurtle ? 'text/turtle' : 'application/ld+json',
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
    json: acceptsTurtle
      ? undefined
      : async () => {
          const raw = await getData()
          return JSON.parse(raw)
        },
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

export function createFetch(): WhatwgFetch {
  const state: { [key: string]: string } = {}
  return addState(state)
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

export const fetch = statelessFetch
