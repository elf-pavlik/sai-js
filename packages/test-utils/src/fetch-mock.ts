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

/** The flat test store's storage root: the container without its last segment. */
function storageRootFor(containerIri: string): string {
  const container = containerIri.replace(/\/$/u, '')
  const cut = container.lastIndexOf('/')
  if (cut < 0) throw new Error(`cannot derive a storage root from ${containerIri}`)
  return `${container.slice(0, cut + 1)}`
}

async function common(
  url: string,
  options?: RequestInit,
  state?: { [key: string]: string }
): Promise<Response> {
  const strippedUrl = url.replace(/#.*$/, '')
  // Access Accept header via type assertion since RequestInit.headers is HeadersInit
  const accept = (options?.headers as Record<string, string> | undefined)?.Accept

  // LWS storage description: the requested storage root is the StorageRoot.
  if (accept === 'application/lws+cid') {
    return {
      ok: true,
      headers: { get: () => 'application/lws+cid' },
      json: async () => ({
        id: strippedUrl,
        type: 'Storage',
        service: [{ type: 'StorageRoot', serviceEndpoint: strippedUrl }],
      }),
    } as unknown as Response
  }

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
    Link: `<${strippedUrl}.acr>; rel="acl", <http://just.en.example/description-resource>; rel="describedby", <${STORAGE_DESCRIPTION_IRI}>; rel="http://www.w3.org/ns/solid/terms#storageDescription", <${storageRootFor(strippedUrl)}>; rel="https://www.w3.org/ns/lws#storage"`,
  }

  const response = {
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
  } as unknown as Response
  response.clone = () => ({ ...response })
  return response
}

/**
 * The identifier the flat LWS store allocates for a POST: the `slug` header
 * (a UUID, which our clients pre-mint) under the storage root — the container
 * IRI without its last path segment. Mirrors the flat identifier strategy.
 */
function slugLocation(containerIri: string, headers?: HeadersInit): string {
  const record = (headers ?? {}) as Record<string, string>
  const slug = record.slug ?? record.Slug
  if (!slug) throw new Error('POST without a slug header')
  return `${storageRootFor(containerIri)}${slug}`
}

function postResponse(location: string): Response {
  const response = {
    ok: true,
    status: 201,
    headers: { get: (name: string) => (name.toLowerCase() === 'location' ? location : undefined) },
  } as unknown as Response
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

    if (options?.method === 'POST') {
      const location = slugLocation(url, options.headers)
      if (typeof options.body === 'string' && options.body.length > 2) {
        state[location] = options.body
      }
      return postResponse(location)
    }

    if (options?.method === 'DELETE') {
      delete state[url]
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
  if (options?.method === 'POST') {
    return postResponse(slugLocation(url, options.headers))
  }
  return common(url, options)
} as WhatwgFetch

export const fetch = statelessFetch
