import { describe, expect, test, vi } from 'vitest'

import {
  AUXILIARY_DISCOVERY_ACCEPT,
  type WhatwgFetch,
  discoverAccessResource,
  discoverAuthorizationAgent,
  discoverAuthorizationRedirectEndpoint,
  discoverDelegationIssuanceEndpoint,
  discoverDescriptionResource,
  discoverWebPushService,
  storageIri,
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

describe('storageIri', () => {
  const storageDescriptionIri = 'https://fake.example/storage-desription'
  const spaceStorage = 'http://www.w3.org/ns/pim/space#Storage'

  test('resolves the storage IRI from the container id', async () => {
    const mock = vi.fn(async (input: RequestInfo, init?: RequestInit) => {
      if (init?.method === 'HEAD') {
        return {
          ok: true,
          headers: {
            get: (name: string) =>
              name === 'Link'
                ? `<${storageDescriptionIri}>; rel="http://www.w3.org/ns/solid/terms#storageDescription"`
                : undefined,
          },
        } as unknown as Response
      }
      return {
        ok: true,
        json: async () => [{ '@id': storageDescriptionIri, '@type': [spaceStorage] }],
      } as unknown as Response
    })

    const iri = await storageIri(
      { id: 'https://home.alice.example/registry/' },
      mock as unknown as WhatwgFetch
    )
    expect(iri).toBe(storageDescriptionIri)
  })

  test('prefers the LWS storage link and the StorageRoot service', async () => {
    const storage = 'https://home.alice.example/'
    const mock = vi.fn(async (_input: RequestInfo, init?: RequestInit) => {
      if (init?.method === 'HEAD') {
        return {
          ok: true,
          headers: {
            get: (name: string) =>
              name === 'Link' ? `<${storage}>; rel="https://www.w3.org/ns/lws#storage"` : undefined,
          },
        } as unknown as Response
      }
      return {
        ok: true,
        headers: {
          get: (name: string) => (name === 'Content-Type' ? 'application/lws+cid' : undefined),
        },
        json: async () => ({
          id: storage,
          type: 'Storage',
          service: [{ type: 'StorageRoot', serviceEndpoint: storage }],
        }),
      } as unknown as Response
    })

    const iri = await storageIri(
      { id: 'https://home.alice.example/registry/' },
      mock as unknown as WhatwgFetch
    )
    expect(iri).toBe(storage)
  })
})

describe('discoverAccessResource', () => {
  const root = 'https://registry.example/alice/'

  function headFetch(link: string) {
    return vi.fn(
      async () => ({ ok: true, headers: new Headers({ link }) }) as unknown as Response
    ) as unknown as WhatwgFetch
  }

  test('sends an explicit RDF Accept so a storage root is not described', async () => {
    const fetch = headFetch(`<${root}.acr>; rel="acl"`)
    const acr = await discoverAccessResource(root, fetch)
    expect(acr).toBe(`${root}.acr`)
    // a wildcard (or absent) Accept makes a storage root answer with the LWS
    // storage description, which carries no auxiliary links
    expect(fetch).toHaveBeenCalledWith(root, {
      method: 'HEAD',
      headers: { Accept: AUXILIARY_DISCOVERY_ACCEPT },
    })
  })

  test('returns undefined when the response has no acl link', async () => {
    const fetch = headFetch(`<${root}>; rel="https://www.w3.org/ns/lws#storage"`)
    expect(await discoverAccessResource(root, fetch)).toBeUndefined()
  })
})

describe('discoverDescriptionResource', () => {
  test('sends the same explicit Accept', async () => {
    const iri = 'https://registry.example/alice/social-agent/x/'
    const fetch = vi.fn(
      async () =>
        ({
          ok: true,
          headers: new Headers({ link: `<${iri}.meta>; rel="describedby"` }),
        }) as unknown as Response
    ) as unknown as WhatwgFetch
    expect(await discoverDescriptionResource(iri, fetch)).toBe(`${iri}.meta`)
    expect(fetch).toHaveBeenCalledWith(iri, {
      method: 'HEAD',
      headers: { Accept: AUXILIARY_DISCOVERY_ACCEPT },
    })
  })
})
