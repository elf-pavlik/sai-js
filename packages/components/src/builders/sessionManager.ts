import { createLwsFetch, type WhatwgFetch } from '@janeirodigital/interop-utils'
import { type GenerateKeyPairResult, generateKeyPair } from 'jose'

import { EnvJwkGenerator } from '../EnvJwkGenerator.js'
import { SelfIssuedSession } from '../SelfIssuedSession.js'
import { SessionManager } from '../SessionManager.js'
import { agentId } from '../util/uriTemplates.js'

export function buildSessionManager(): SessionManager {
  const jwkGenerator = new EnvJwkGenerator(process.env.CSS_ENCODED_PRIVATE_JWK)
  return new SessionManager(process.env.CSS_BASE_URL, jwkGenerator, process.env.CSS_REG_ORIGIN, 60)
}

/**
 * The self-issued session plus its DPoP key pair — the pairing `SessionManager`
 * uses: the ID token is the LWS subject token, and the key pair signs both the
 * token's `cnf` and the proof at the token endpoint.
 */
async function buildSelfIssued(
  webid: string,
  clientId?: string,
  expiration = 60
): Promise<{ oidc: SelfIssuedSession; dpopKeyPair: GenerateKeyPairResult }> {
  const baseUrl = process.env.CSS_BASE_URL

  const jwkGenerator = new EnvJwkGenerator(process.env.CSS_ENCODED_PRIVATE_JWK)

  const privateKey = await jwkGenerator.getPrivateKey()
  const publicKey = await jwkGenerator.getPublicKey()

  const dpopKeyPair = await generateKeyPair('ES256')

  const oidc = new SelfIssuedSession({
    webid,
    clientId: clientId ?? agentId(webid),
    issuer: baseUrl,
    expiresIn: expiration * 60 * 1000,
    privateKey,
    publicKey,
    dpopKeyPair,
  })
  await oidc.login()
  return { oidc, dpopKeyPair }
}

export async function buildOidcSession(
  webid: string,
  clientId?: string,
  expiration = 60
): Promise<SelfIssuedSession> {
  const { oidc } = await buildSelfIssued(webid, clientId, expiration)
  return oidc
}

/**
 * The LWS storage fetch for `webid` — the storage-facing counterpart of
 * `buildOidcSession(...).authFetch`. Data and registry storages accept only
 * LWS access tokens, so every request exchanges the self-issued ID token for
 * one; `clientId` becomes the ID token's `azp`, i.e. the LWS token's
 * `client_id`, so callers can exercise agent/client combinations the way the
 * real clients do.
 */
export async function buildLwsFetch(webid: string, clientId?: string): Promise<WhatwgFetch> {
  const { oidc, dpopKeyPair } = await buildSelfIssued(webid, clientId)
  return createLwsFetch({
    subjectToken: () => oidc.generateSelfIssuedAccessToken(),
    dpopKeyPair,
  })
}
