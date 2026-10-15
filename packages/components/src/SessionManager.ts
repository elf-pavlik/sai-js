import { AuthorizationAgent } from '@janeirodigital/interop-authorization-agent'
import type { JwkGenerator } from '@solid/community-server'
import { generateKeyPair } from 'jose'

import { buildAccountLoginStorage } from './builders/accountLoginStorage.js'
import { SelfIssuedSession } from './SelfIssuedSession.js'
import { SparqlEndpointStore } from './SparqlEndpointStore.js'
import type { SparqlEndpointRecord } from './SparqlEndpointStore.js'
import { agentId, registryId } from './util/uriTemplates.js'

/**
 * Shared lazy endpoint store for contexts without config injection (the worker
 * and the test harness `buildSessionManager()`). Built once so the many
 * `buildSessionManager()` call sites don't each open a Postgres pool.
 */
let sharedEndpointStorePromise: Promise<SparqlEndpointStore> | undefined

function getSharedEndpointStore(): Promise<SparqlEndpointStore> {
  if (!sharedEndpointStorePromise) {
    sharedEndpointStorePromise = (async () => {
      const store = new SparqlEndpointStore(await buildAccountLoginStorage())
      await store.handle()
      return store
    })()
  }
  return sharedEndpointStorePromise
}

export class SessionManager {
  private endpointStore?: SparqlEndpointStore

  public constructor(
    private readonly baseUrl: string,
    private readonly jwkGenerator: JwkGenerator,
    private regOrigin: string,
    private readonly expiration: number,
    private readonly sparqlEndpoint: string,
    endpointStore?: SparqlEndpointStore
  ) {
    this.endpointStore = endpointStore
  }

  /**
   * The endpoint registry is injected by the CSS config on the auth server. In
   * the worker and the test harness `buildSessionManager()` constructs the
   * manager without one, so fall back to the shared lazy store (and the env-var
   * endpoint if even that is unavailable).
   */
  private async resolveEndpointStore(): Promise<SparqlEndpointStore | undefined> {
    if (this.endpointStore) {
      return this.endpointStore
    }
    return getSharedEndpointStore()
  }

  public async getSession(webid: string, registrySetId?: string): Promise<AuthorizationAgent> {
    const privateKey = await this.jwkGenerator.getPrivateKey()
    const publicKey = await this.jwkGenerator.getPublicKey()

    const dpopKeyPair = await generateKeyPair('ES256')

    const oidc = new SelfIssuedSession({
      webid,
      clientId: agentId(webid),
      issuer: this.baseUrl,
      expiresIn: this.expiration * 60 * 1000,
      privateKey,
      publicKey,
      dpopKeyPair,
    })
    await oidc.login()

    // per-pod endpoint registry (isolated-datasets-and-sparql.md 4a): the
    // owner's records from the internal account storage are the session's
    // endpoint allowlist; the registry pod URL is the registry-set IRI. The
    // env-var endpoint remains the fallback.
    const registryPodUrl = registrySetId ?? registryId(webid)
    const records: SparqlEndpointRecord[] =
      (await this.resolveEndpointStore()
        .then((store) => store?.findByWebId(webid))
        .catch(() => undefined)) ?? []
    const sparqlEndpoints = new Map<string, string>(
      records.map((record) => [record.podUrl, record.endpoint])
    )
    const endpoint = sparqlEndpoints.get(registryPodUrl) ?? this.sparqlEndpoint

    return AuthorizationAgent.build(webid, agentId(webid), registryPodUrl, {
      fetch: oidc.authFetch.bind(oidc),
      randomUUID: crypto.randomUUID.bind(crypto),
      sparqlEndpoint: endpoint,
      sparqlEndpoints,
    })
  }
}
