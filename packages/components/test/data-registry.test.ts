import type { AuthorizationAgent } from '@janeirodigital/interop-authorization-agent'
import { describe, expect, test } from 'vitest'
import type { ResolvedContext } from '../src/services/Context.js'
import { getDataRegistries } from '../src/services/DataRegistry.js'

// ──────────────────────────
// Fixtures
// ──────────────────────────

const ORG_WEBID = 'https://yoyo.example/profile/card#me'
const ORG_AA = 'https://yoyo.example/.sai/agents/zzzz'
const USER_WEBID = 'https://dan.example/profile/card#me'
const DATA_REGISTRY = 'https://data/yoyo/'
const DATA_REG = `${DATA_REGISTRY}projects/`
const SHAPE_TREE = 'https://shapetrees.example/Project'
const STORAGE = 'https://yoyo.example/storage'

/** The registration body served for the data-registration graph (CONSTRUCT). */
const registrationTurtle = `PREFIX interop: <http://www.w3.org/ns/solid/interop#>
<${DATA_REG}> a interop:DataRegistration ;
  interop:registeredShapeTree <${SHAPE_TREE}> .
`

/** Storage description doc — `storageIri` stays HTTP data-plane. */
const storageDescriptionDoc = [
  {
    '@id': STORAGE,
    '@type': ['http://www.w3.org/ns/pim/space#Storage'],
  },
]

const orgProfileDoc = {
  '@id': ORG_WEBID,
  'http://www.w3.org/ns/solid/interop#hasAuthorizationAgent': { '@id': ORG_AA },
}

function mockResponse(body: unknown, status = 200, contentType = 'application/ld+json'): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (name: string) => (name.toLowerCase() === 'content-type' ? contentType : null),
    },
    json: async () => body,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  } as unknown as Response
}

const sparqlAdminUrl = `${new URL(ORG_AA).origin}/.sai/sparql-admin/${Buffer.from(ORG_WEBID).toString('base64url')}`

/** Storage-description discovery header served on HEAD of the data registry. */
const storageLink = `<${STORAGE}>; rel="http://www.w3.org/ns/solid/terms#storageDescription"`

/** Minimal resolved org context (webId ≠ userWebId routes via /sparql-admin). */
function orgCtx(session: AuthorizationAgent): ResolvedContext {
  return {
    session,
    webId: ORG_WEBID,
    userWebId: USER_WEBID,
    registrySet: { hasDataRegistry: [{ id: DATA_REGISTRY }] },
  } as unknown as ResolvedContext
}

// ──────────────────────────
// getDataRegistries — own data-registry listings via SPARQL (docs/sparql.md step 4)
// ──────────────────────────

describe('getDataRegistries — org context lists own data registries via /sparql-admin', () => {
  test('hasDataRegistration listing + per-registration body; storage description stays HTTP', async () => {
    const requests: { url: string; init?: RequestInit }[] = []
    const sessionFetch = async (url: string, init?: RequestInit) => {
      requests.push({ url, init })
      if (url === ORG_WEBID) return mockResponse(orgProfileDoc)
      if (url === sparqlAdminUrl) {
        const query = String(init?.body ?? '')
        if (query.includes('SELECT')) {
          // the SPARQL listing must carry the hasDataRegistration predicate
          expect(query).toContain('hasDataRegistration')
          return mockResponse(
            {
              head: { vars: ['child'] },
              results: { bindings: [{ child: { type: 'uri', value: DATA_REG } }] },
            },
            200,
            'application/sparql-results+json'
          )
        }
        if (query.includes('CONSTRUCT')) {
          return mockResponse(registrationTurtle, 200, 'text/turtle')
        }
        throw new Error(`unexpected sparql-admin query: ${query}`)
      }
      if (url === DATA_REGISTRY) {
        // storage-description discovery: HEAD + Link header
        return {
          ok: true,
          status: 200,
          headers: {
            get: (name: string) => (name.toLowerCase() === 'link' ? storageLink : null),
          },
          json: async () => ({}),
          text: async () => '',
        } as unknown as Response
      }
      if (url === STORAGE) {
        return mockResponse(storageDescriptionDoc)
      }
      if (url === SHAPE_TREE) {
        return mockResponse({ '@id': SHAPE_TREE, 'http://www.w3.org/ns/shapetrees#references': [] })
      }
      throw new Error(`unexpected request: ${url}`)
    }
    const session = {
      fetch: sessionFetch,
    } as unknown as AuthorizationAgent

    // agentId === ctx.webId — the "own registries" branch
    const registries = await getDataRegistries(orgCtx(session), ORG_WEBID, '')

    expect(registries).toHaveLength(1)
    expect(registries[0].id).toBe(DATA_REGISTRY)
    expect(registries[0].label).toBe(STORAGE)
    expect(registries[0].registrations).toEqual([
      expect.objectContaining({
        id: DATA_REG,
        shapeTree: SHAPE_TREE,
        dataRegistry: DATA_REGISTRY,
        count: 0,
      }),
    ])
    const sparqlRequests = requests.filter((request) => request.url === sparqlAdminUrl)
    expect(sparqlRequests).toHaveLength(2)
  })
})
