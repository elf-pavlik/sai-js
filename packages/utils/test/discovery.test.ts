import { describe, expect, test, vi } from 'vitest'
import {
  discoverAuthorizationAgent,
  discoverAuthorizationRedirectEndpoint,
  discoverDelegationIssuanceEndpoint,
  discoverWebPushService,
} from '../src'

const aliceId = 'https://id/alice'
const aliceAgentId = 'https://auth/.sai/agents/aHR0cHM6Ly9pZC9hbGljZQ'
const INTEROP = 'http://www.w3.org/ns/solid/interop#'
const NOTIFY = 'http://www.w3.org/ns/solid/notifications#'

const webIdDoc = [
  {
    '@id': aliceId,
    [`${INTEROP}hasAuthorizationAgent`]: [{ '@id': aliceAgentId }],
  },
]

const uasDoc = [
  {
    '@id': aliceAgentId,
    [`${INTEROP}hasAuthorizationRedirectEndpoint`]: [{ '@id': 'https://ui.auth/authorize' }],
    [`${INTEROP}hasDelegationIssuanceEndpoint`]: [{ '@id': 'https://auth/.sai/grants' }],
    [`${INTEROP}pushService`]: [{ '@id': 'https://auth/.sai/webpush' }],
    [`${NOTIFY}vapidPublicKey`]: [
      {
        '@value':
          'BNUaG9vwp-WE_cX-3dNLebyczW_RivE8wHECIvZIUMUZ3co6P79neE3hueJJtFcg5ezTZ25T1ITciujz-mlAcnY',
      },
    ],
  },
]

/** Mock WhatwgFetch serving JSON-LD docs by URL (vi.fn so call counts are assertable). */
function jsonldFetch(docs: Record<string, unknown>) {
  return vi.fn(async (input: RequestInfo) => {
    const url = typeof input === 'string' ? input : input.url
    return {
      ok: true,
      json: async () => docs[url],
    } as unknown as Response
  })
}

describe('discoverAuthorizationAgent', () => {
  test('discovers the Authorization Agent from the WebID document', async () => {
    const mock = jsonldFetch({ [aliceId]: webIdDoc })
    const iri = await discoverAuthorizationAgent(aliceId, mock)
    expect(iri).toBe(aliceAgentId)
  })

  test('returns undefined when the WebID document has no Authorization Agent', async () => {
    const mock = jsonldFetch({ [aliceId]: [{ '@id': aliceId }] })
    const iri = await discoverAuthorizationAgent(aliceId, mock)
    expect(iri).toBeUndefined()
  })
})

describe('discoverDelegationIssuanceEndpoint', () => {
  test('uses the injected fetch for both requests and returns the endpoint', async () => {
    const mock = jsonldFetch({ [aliceId]: webIdDoc, [aliceAgentId]: uasDoc })
    const endpoint = await discoverDelegationIssuanceEndpoint(aliceId, mock)
    expect(endpoint).toBe('https://auth/.sai/grants')
    // two requests: the WebID document and the Authorization Agent document
    expect(mock.mock.calls).toHaveLength(2)
    expect(mock.mock.calls[1][0]).toBe(aliceAgentId)
  })
})

describe('discoverAuthorizationRedirectEndpoint', () => {
  test('discovers the authorization uri from the Authorization Agent document', async () => {
    const mock = jsonldFetch({ [aliceAgentId]: uasDoc })
    const iri = await discoverAuthorizationRedirectEndpoint(aliceAgentId, mock)
    expect(iri).toBe('https://ui.auth/authorize')
  })
})

describe('discoverWebPushService', () => {
  test('discovers the web push service from the Authorization Agent document', async () => {
    const mock = jsonldFetch({ [aliceAgentId]: uasDoc })
    const service = await discoverWebPushService(aliceAgentId, mock)
    expect(service).toEqual({
      id: 'https://auth/.sai/webpush',
      vapidPublicKey:
        'BNUaG9vwp-WE_cX-3dNLebyczW_RivE8wHECIvZIUMUZ3co6P79neE3hueJJtFcg5ezTZ25T1ITciujz-mlAcnY',
    })
  })

  test('returns undefined when the service is not found', async () => {
    const mock = jsonldFetch({ [aliceAgentId]: [{ '@id': aliceAgentId }] })
    const service = await discoverWebPushService(aliceAgentId, mock)
    expect(service).toBeUndefined()
  })
})
