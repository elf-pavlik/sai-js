import type { AlgJwk } from '@solid/community-server'
import { SessionCore, type SessionOptions } from '@uvdsl/solid-oidc-client-browser/core'
import { SignJWT, calculateJwkThumbprint, exportJWK } from 'jose'
import type { GenerateKeyPairResult } from 'jose'

interface TokenDetails {
  access_token: string
  id_token?: string
  refresh_token?: string
  scope?: string
  expires_in: number
  token_type: string
  dpop_key_pair: GenerateKeyPairResult
}

interface SelfIssuedSessionOptions extends SessionOptions {
  webid: string
  clientId: string
  issuer: string
  expiresIn: number
  privateKey: AlgJwk
  publicKey: AlgJwk
  dpopKeyPair: GenerateKeyPairResult
}

//@ts-ignore
export class SelfIssuedSession extends SessionCore {
  private webid: string
  private clientId: string
  private issuer: string
  private expiresIn: number
  private privateKey: AlgJwk
  private publicKey: AlgJwk
  private dpopKeyPair: GenerateKeyPairResult

  // use private readonly { webid, clientId, ...}: SelfIssuedSessionOptions
  constructor(sessionOptions?: SelfIssuedSessionOptions) {
    super({ client_id: sessionOptions.clientId }, sessionOptions)
    this.webid = sessionOptions.webid
    this.clientId = sessionOptions.clientId
    this.issuer = sessionOptions.issuer
    this.expiresIn = sessionOptions.expiresIn
    this.privateKey = sessionOptions.privateKey
    this.publicKey = sessionOptions.publicKey
    this.dpopKeyPair = sessionOptions.dpopKeyPair
  }

  /**
   * Login by generating a self-issued access token.
   */
  async login(): Promise<void> {
    const accessToken = await this.generateSelfIssuedAccessToken()

    const tokenDetails: TokenDetails = {
      access_token: accessToken,
      expires_in: 3600,
      dpop_key_pair: this.dpopKeyPair,
      token_type: 'DPoP',
    }

    await this.setTokenDetails(tokenDetails)
  }

  /**
   * Not applicable for self-issued, but implemented as no-op.
   */
  async handleRedirectFromLogin(): Promise<void> {
    // No-op
  }

  async restore(): Promise<void> {
    // TODO?
  }

  /**
   * Generate a self-issued access token for Solid.
   * The token is signed with the DPoP private key and bound to the DPoP public key.
   */
  async generateSelfIssuedAccessToken(): Promise<string> {
    const thumbprint = await calculateJwkThumbprint(
      await exportJWK(this.dpopKeyPair.publicKey),
      'sha256'
    )

    const now = Math.floor(Date.now() / 1000)
    const exp = now + this.expiresIn

    return new SignJWT({
      webid: this.webid,
      client_id: this.clientId,
      cnf: { jkt: thumbprint },
    })
      .setProtectedHeader({
        alg: this.privateKey.alg,
        typ: 'at+jwt',
        kid: await calculateJwkThumbprint(this.publicKey, 'sha256'),
      })
      .setIssuer(this.issuer)
      .setSubject(this.webid)
      .setAudience('solid')
      .setIssuedAt(now)
      .setExpirationTime(exp)
      .setJti(crypto.randomUUID())
      .sign(this.privateKey)
  }

  /**
   * Creates a signed DPoP (Demonstration of Proof-of-Possession) token.
   *
   * @param payload The payload to include in the DPoP token. By default, it includes `htu` (HTTP target URI) and `htm` (HTTP method).
   * @returns A promise that resolves to the signed DPoP token string.
   * @throws Error if the session has not been initialized - if no token details are available.
   */
  private async _createSignedDPoPToken(payload: any) {
    //@ts-ignore
    if (!this.information.tokenDetails || !this.currentAth_) {
      throw new Error('Session not established.')
    }
    //@ts-ignore
    payload.ath = this.currentAth_
    const jwk_public_key = await exportJWK(
      //@ts-ignore
      this.information.tokenDetails.dpop_key_pair.publicKey
    )
    return (
      new SignJWT(payload)
        .setIssuedAt()
        .setJti(globalThis.crypto.randomUUID())
        .setProtectedHeader({
          alg: 'ES256',
          typ: 'dpop+jwt',
          jwk: jwk_public_key,
        })
        //@ts-ignore
        .sign(this.information.tokenDetails.dpop_key_pair.privateKey)
    )
  }
}
