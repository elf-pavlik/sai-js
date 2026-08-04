import type { Hono } from 'hono'
import { DataFactory } from 'n3'
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest'

const mockFetchTriples = vi.fn()

vi.mock('fetch-sparql-endpoint', () => {
  return {
    SparqlEndpointFetcher: vi.fn().mockImplementation(() => ({
      fetchTriples: mockFetchTriples.mockResolvedValue({
        toArray: vi.fn().mockResolvedValue([]),
      }),
    })),
  }
})

const idOrigin = 'example.org'
const docOrigin = 'doc.example.org'
const sparqlEndpoint = 'http://test.example.org/sparql'

let app: Hono

beforeAll(async () => {
  vi.stubEnv('ID_ORIGIN', idOrigin)
  vi.stubEnv('DOC_ORIGIN', docOrigin)
  vi.stubEnv('CSS_SPARQL_ENDPOINT', sparqlEndpoint)
  app = (await import('./server')).default
})

afterAll(() => {
  vi.unstubAllEnvs()
})

describe('id', () => {
  test('request id without host', async () => {
    const res = await app.request('/')
    expect(res.status).toBe(400)
    expect(await res.text()).toBe('missing host')
  })
  test('request id without subdomain', async () => {
    const res = await app.request('/', {
      headers: {
        Host: idOrigin,
      },
    })
    expect(res.status).toBe(400)
    expect(await res.text()).toBe('invalid subdomain count')
  })

  // this will end up handled by doc route
  test('request id with subdomain and path', async () => {
    const res = await app.request('/oops', {
      headers: {
        Host: `sub.${idOrigin}`,
      },
    })
    expect(res.status).toBe(400)
    expect(await res.text()).toBe('wrong doc origin')
  })
  test('request id with subdomain', async () => {
    const res = await app.request('/', {
      headers: {
        Host: `sub.${idOrigin}`,
      },
    })
    expect(res.status).toBe(303)
    expect(res.headers.get('Location')).toBe(`https://${docOrigin}/sub`)
  })
  test('request id with invalid domain', async () => {
    const res = await app.request('/', {
      headers: {
        Host: 'sub.wrong.org',
      },
    })
    expect(res.status).toBe(400)
    expect(await res.text()).toBe('invalid domain')
  })
})
describe('doc', () => {
  test('request doc without subdomain', async () => {
    const res = await app.request('/somehandle', {
      headers: {
        Host: `${docOrigin}`,
      },
    })
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('text/turtle')
    expect(mockFetchTriples).toHaveBeenCalledWith(
      sparqlEndpoint,
      expect.stringContaining(`GRAPH <https://${docOrigin}/somehandle>`)
    )
  })
  test('request doc with subdomain', async () => {
    const res = await app.request('/anotherhandle', {
      headers: {
        Host: 'sub.${docOrigin}',
      },
    })
    expect(res.status).toBe(400)
    expect(await res.text()).toBe('wrong doc origin')
  })
  test('request doc as jsonld', async () => {
    mockFetchTriples.mockResolvedValue({
      toArray: vi.fn().mockResolvedValue([
        DataFactory.quad(
          DataFactory.namedNode(`https://${docOrigin}/somehandle`),
          DataFactory.namedNode('http://www.w3.org/2000/01/rdf-schema#label'),
          DataFactory.literal('Alice')
        ),
        DataFactory.quad(
          DataFactory.namedNode(`https://${docOrigin}/somehandle`),
          DataFactory.namedNode('http://www.w3.org/ns/solid/terms#oidcIssuer'),
          DataFactory.namedNode(`https://${idOrigin}`)
        ),
      ]),
    })
    const res = await app.request('/somehandle', {
      headers: {
        Host: docOrigin,
        Accept: 'application/ld+json',
      },
    })
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('application/ld+json')
    expect(await res.json()).toEqual([
      {
        '@id': `https://${docOrigin}/somehandle`,
        'http://www.w3.org/2000/01/rdf-schema#label': [{ '@value': 'Alice' }],
        'http://www.w3.org/ns/solid/terms#oidcIssuer': [{ '@id': `https://${idOrigin}` }],
      },
    ])
  })
})
