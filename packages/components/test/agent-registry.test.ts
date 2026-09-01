import type { AuthorizationAgent } from '@janeirodigital/interop-authorization-agent'
import { describe, expect, test } from 'vitest'
import { getApplications } from '../src/services/ApplicationRegistry.js'
import { getSocialAgentInvitations } from '../src/services/InvitationRegistry.js'
import type { ResolvedContext } from '../src/services/Context.js'

// ──────────────────────────
// Fixtures
// ──────────────────────────

const ORG_WEBID = 'https://yoyo.example/profile/card#me'
const ORG_AA = 'https://yoyo.example/.sai/agents/zzzz'
const USER_WEBID = 'https://dan.example/profile/card#me'
const SOCIAL_AGENT_REGISTRY = 'https://registry/yoyo/social-agent/'
const APPLICATION_REGISTRY = 'https://registry/yoyo/application/'
const INVITATION_REGISTRY = 'https://registry/yoyo/invitation/'
const APP_REG = `${APPLICATION_REGISTRY}p9xnub/`
const APP_WEBID = 'https://projectron.example/#app'

/** The registration body served for the application's graph (CONSTRUCT). */
const appRegistrationTurtle = `PREFIX interop: <http://www.w3.org/ns/solid/interop#>
<${APP_REG}> a interop:ApplicationRegistration ;
  interop:registeredAgent <${APP_WEBID}> .
`

/** The app's client-id document (webid/client-id profiles stay HTTP). */
const clientIdDocument = {
  '@context': [
    'https://www.w3.org/ns/solid/oidc-context.jsonld',
    { interop: 'http://www.w3.org/ns/solid/interop#' },
  ],
  client_id: APP_WEBID,
  client_name: 'Projectron',
  logo_uri: 'https://projectron.example/logo.png',
  'interop:hasAccessNeedGroup': 'https://projectron.example/needs',
  'interop:hasAuthorizationCallbackEndpoint': 'https://projectron.example/callback',
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
    registrySet: {
      hasSocialAgentRegistry: { id: SOCIAL_AGENT_REGISTRY },
      hasApplicationRegistry: { id: APPLICATION_REGISTRY },
      hasInvitationRegistry: { id: INVITATION_REGISTRY },
    },
  } as unknown as ResolvedContext
}

const sparqlAdminUrl = `${new URL(ORG_AA).origin}/.sai/sparql-admin/${Buffer.from(ORG_WEBID).toString('base64url')}`

// ──────────────────────────
// getApplications — application registrations via SPARQL (docs/sparql.md step 3)
// ──────────────────────────

describe('getApplications — org context lists applications via /sparql-admin', () => {
  test('ldp:contains listing + per-registration body; profile from the client-id document', async () => {
    const requests: { url: string; init?: RequestInit }[] = []
    const session = {
      fetch: async (url: string, init?: RequestInit) => {
        requests.push({ url, init })
        if (url === ORG_WEBID) return mockResponse(orgProfileDoc)
        if (url === APP_WEBID) return mockResponse(clientIdDocument)
        if (url !== sparqlAdminUrl) throw new Error(`unexpected request: ${url}`)
        const query = String(init?.body ?? '')
        if (query.includes('SELECT')) {
          // the SPARQL listing must read the server-managed ldp:contains
          // of the dedicated application registry container
          expect(query).toContain('ldp#contains')
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
    } as unknown as AuthorizationAgent

    const applications = await getApplications(orgCtx(session))

    expect(applications).toEqual([
      {
        id: APP_WEBID,
        name: 'Projectron',
        logo: 'https://projectron.example/logo.png',
        accessNeedGroup: 'https://projectron.example/needs',
        callbackEndpoint: 'https://projectron.example/callback',
      },
    ])
    // profile dereferences the client-id document over HTTP — one webid
    // profile + one listing + one body read
    expect(requests.filter((request) => request.url === sparqlAdminUrl)).toHaveLength(2)
  })
})

// ──────────────────────────
// getSocialAgentInvitations — invitations via SPARQL (docs/sparql.md, candidate)
// ──────────────────────────

describe('getSocialAgentInvitations — org context lists invitations via /sparql-admin', () => {
  const INVITE_IRI = `${INVITATION_REGISTRY}zi1nic`
  const SETTLED_IRI = `${INVITATION_REGISTRY}settled`
  const CAPABILITY = 'https://yoyo.example/invitations/zi1nic'

  const inviteTurtle = (
    iri: string,
    registeredAgent?: string
  ) => `PREFIX interop: <http://www.w3.org/ns/solid/interop#>
PREFIX skos: <http://www.w3.org/2004/02/skos/core#>
<${iri}> a interop:SocialAgentInvitation ;
  interop:hasCapabilityUrl <${CAPABILITY}> ;
  skos:prefLabel "Invite" ;
  skos:note "A note"${
    registeredAgent
      ? ` ;
  interop:registeredAgent <${registeredAgent}>`
      : ''
  } .
`

  test('ldp:contains listing + per-invitation body; settled invitations excluded', async () => {
    const session = {
      fetch: async (url: string, init?: RequestInit) => {
        if (url === ORG_WEBID) return mockResponse(orgProfileDoc)
        if (url !== sparqlAdminUrl) throw new Error(`unexpected request: ${url}`)
        const query = String(init?.body ?? '')
        if (query.includes('SELECT')) {
          // the SPARQL listing must read the invitation registry's ldp:contains
          expect(query).toContain('ldp#contains')
          return mockResponse(
            {
              head: { vars: ['child'] },
              results: {
                bindings: [INVITE_IRI, SETTLED_IRI].map((iri) => ({
                  child: { type: 'uri', value: iri },
                })),
              },
            },
            200,
            'application/sparql-results+json'
          )
        }
        if (query.includes('CONSTRUCT')) {
          return mockResponse(
            query.includes(`GRAPH <${INVITE_IRI}>`)
              ? inviteTurtle(INVITE_IRI)
              : inviteTurtle(SETTLED_IRI, 'https://dan.example/profile/card#me'),
            200,
            'text/turtle'
          )
        }
        throw new Error(`unexpected sparql-admin query: ${query}`)
      },
    } as unknown as AuthorizationAgent

    const invitations = await getSocialAgentInvitations(orgCtx(session))

    // only the invitation without registeredAgent survives
    expect(invitations).toEqual([
      {
        id: INVITE_IRI,
        capabilityUrl: CAPABILITY,
        label: 'Invite',
        note: 'A note',
      },
    ])
  })
})