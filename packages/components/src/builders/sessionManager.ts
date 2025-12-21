import { generateKeyPair } from 'jose'
import { EnvJwkGenerator } from '../EnvJwkGenerator.js'
import { SelfIssuedSession } from '../SelfIssuedSession.js'
import { SessionManager } from '../SessionManager.js'

export function buildSessionManager(): SessionManager {
  const jwkGenerator = new EnvJwkGenerator(process.env.CSS_ENCODED_PRIVATE_JWK)
  return new SessionManager(process.env.CSS_BASE_URL, jwkGenerator, 60)
}

export async function buildOidcSession(
  webid: string,
  clientId?: string,
  expiration = 60
): Promise<SelfIssuedSession> {
  const pathPrefix = '.sai/agents/'
  const baseUrl = process.env.CSS_BASE_URL

  const encodedWebId = Buffer.from(webid).toString('base64url')
  const agentId = `${baseUrl}${pathPrefix}${encodedWebId}`
  const jwkGenerator = new EnvJwkGenerator(process.env.CSS_ENCODED_PRIVATE_JWK)

  const privateKey = await jwkGenerator.getPrivateKey()
  const publicKey = await jwkGenerator.getPublicKey()

  const dpopKeyPair = await generateKeyPair('ES256')

  const oidc = new SelfIssuedSession({
    webid,
    clientId: clientId ?? agentId,
    issuer: baseUrl,
    expiresIn: expiration * 60 * 1000,
    privateKey,
    publicKey,
    dpopKeyPair,
  })
  await oidc.login()
  return oidc
}
