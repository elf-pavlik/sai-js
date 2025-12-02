import { createPublicKey } from 'node:crypto'
import type { KeyObject } from 'node:crypto'
import type { AlgJwk, JwkGenerator } from '@solid/community-server'
import { exportJWK, importJWK } from 'jose'
import type { AsymmetricSigningAlgorithm } from 'oidc-provider'

/**
 * Uses the private key from environment
 * The public key is determined based on the private key and then also stored in memory.
 */
export class EnvJwkGenerator implements JwkGenerator {
  private privateJwk?: AlgJwk
  private publicJwk?: AlgJwk
  public readonly alg: AsymmetricSigningAlgorithm

  public constructor(private readonly encodedPrivateJwk: string) {
    this.privateJwk = JSON.parse(
      Buffer.from(this.encodedPrivateJwk, 'base64url').toString()
    ) as AlgJwk
    this.alg = this.privateJwk.alg
  }

  public async getPrivateKey(): Promise<AlgJwk> {
    return this.privateJwk
  }

  public async getPublicKey(): Promise<AlgJwk> {
    if (this.publicJwk) {
      return this.publicJwk
    }

    const privateJwk = await this.getPrivateKey()
    const privateKey = await importJWK(privateJwk)
    const publicKey = createPublicKey(privateKey as unknown as KeyObject)

    const publicJwk = { ...(await exportJWK(publicKey)) } as AlgJwk
    // These fields get lost during the above proces
    publicJwk.alg = privateJwk.alg

    this.publicJwk = publicJwk
    return publicJwk
  }
}
