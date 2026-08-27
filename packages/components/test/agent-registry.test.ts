import type { AuthorizationAgent } from '@janeirodigital/interop-authorization-agent'
import { describe, expect, test } from 'vitest'
import type { ResolvedContext } from '../src/services/Context.js'
import { getApplications } from '../src/services/AgentRegistry.js'

// ──────────────────────────
// Fixtures
// ──────────────────────────

const ORG_WEBID = 'https://yoyo.example/profile/card#me'
const ORG_AA = 'https://yoyo.example/.sai/agents/zzzz'
const USER_WEBID = 'https://dan.example/profile/card#me'
const AGENT_REGISTRY = 'https://registry/yoyo/agent/'
const APP_REG = `${AGENT_REGISTRY}p9xnub/`
const APP_WEBID = 'https://projectron.example/#app'

/** The registration body served for the application's graph (CONSTRUCT). */
const appRegistrationTurtle = `PREFIX interop: <http://www.w3.org/ns/solid/interop#>
<${APP_REG}> a interop:ApplicationRegistration ;
  interop:registeredAgent <${APP_WEBID}> .
`

/** The app's client-id document (webid/client-id profiles stay HTTP). */
const clientIdDocument = {
  clientName: 'Projectron',
  logoUri: 'https://projectron.example/logo.png',
  hasAccessNeedGroup: 'https://projectron.example/needs',
  callbackEndpoint: 'https://projectron.example/callback',
}

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

/** Minimal resolved org context (webId ≠ userWebId routes via /sparql-admin). */
function orgCtx(session: AuthorizationAgent): ResolvedContext {
  return {
    session,
    webId: ORG_WEBID,
    userWebId: USER_WEBID,
    registrySet: { hasAgentRegistry: { id: AGENT_REGISTRY } },
  } as unknown as ResolvedContext
}

const sparqlAdminUrl = `${new URL(ORG_AA).origin}/.sai/sparql-admin/${Buffer.from(ORG_WEBID).toString('base64url')}`

// ──────────────────────────
// getApplications — application registrations via SPARQL (docs/sparql.md step 3)
// ──────────────────────────

describe('getApplications — org context lists applications via /sparql-admin', () => {
  test('hasApplicationRegistration listing + per-registration body; profile from the client-id document', async () => {
    const requests: { url: string; init?: RequestInit }[] = []
    const session = {
      fetch: async (url: string, init?: RequestInit) => {
        requests.push({ url, init })
        if (url === ORG_WEBID) return mockResponse(orgProfileDoc)
        if (url !== sparqlAdminUrl) throw new Error(`unexpected request: ${url}`)
        const query = String(init?.body ?? '')
        if (query.includes('SELECT')) {
          // the SPARQL listing must carry the hasApplicationRegistration
          // predicate (the seed container has no ldp:contains)
          expect(query).toContain('hasApplicationRegistration')
          return mockResponse(
            {
              head: { vars: ['child'] },
              results: { bindings: [{ child: { type: 'uri', value: APP_REG } }] },
            },
            200,
            'application/sparql-results+json'
          )
        }
        if (query.includes('CONSTRUCT')) {
          return mockResponse(appRegistrationTurtle, 200, 'text/turtle')
        }
        throw new Error(`unexpected sparql-admin query: ${query}`)
      },
      factory: { clientIdDocument: async () => clientIdDocument },
    } as unknown as AuthorizationAgent

    const applications = await getApplications(orgCtx(session))

    expect(applications).toEqual([
      {
        id: APP_WEBID,
        name: 'Projectron',
        logo: clientIdDocument.logoUri,
        accessNeedGroup: clientIdDocument.hasAccessNeedGroup,
        callbackEndpoint: clientIdDocument.callbackEndpoint,
      },
    ])
    // profile dereferences the client-id document over HTTP — one webid
    // profile + one listing + one body read
    expect(requests.filter((request) => request.url === sparqlAdminUrl)).toHaveLength(2)
  })
})