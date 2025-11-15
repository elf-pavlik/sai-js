import { AuthorizationAgent } from '@janeirodigital/interop-authorization-agent'
import type { JwkGenerator } from '@solid/community-server'
import { generateKeyPair } from 'jose'
import { SelfIssuedSession } from './SelfIssuedSession.js'

export class SessionManager {
  public constructor(
    private readonly baseUrl: string,
    private readonly jwkGenerator: JwkGenerator,
    private readonly expiration: number
  ) {}

  public async getSession(webid: string): Promise<AuthorizationAgent> {
    // TODO: make it a variable in configs
    const pathPrefix = '.sai/agents/'

    const encodedWebId = Buffer.from(webid).toString('base64url')
    const agentId = `${this.baseUrl}${pathPrefix}${encodedWebId}`

    const privateKey = await this.jwkGenerator.getPrivateKey()
    const publicKey = await this.jwkGenerator.getPublicKey()

    const dpopKeyPair = await generateKeyPair('ES256')

    const oidc = new SelfIssuedSession({
      webid,
      clientId: agentId,
      issuer: this.baseUrl,
      expiresIn: this.expiration * 60 * 1000,
      privateKey,
      publicKey,
      dpopKeyPair,
    })
    await oidc.login()

    return AuthorizationAgent.build(webid, agentId, {
      fetch: oidc.authFetch.bind(oidc),
      randomUUID: crypto.randomUUID,
    })
  }
}
