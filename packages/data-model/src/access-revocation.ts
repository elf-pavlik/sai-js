/**
 * `interop:AccessRevocation` — the delegation-revocation request body
 * delivered to the data owner's delegation endpoint. `grants` carries **grant
 * IRIs only** — no grant bodies.
 */
export interface AccessRevocationMessage {
  type: string[]
  grants: string[]
}

