/**
 * `interop:AccessRevocationRequest` — the delegation-revocation request body
 * delivered to the data owner's access request endpoint. `grants` carries **grant
 * IRIs only** — no grant bodies.
 */
export interface AccessRevocationMessage {
  type: string[]
  grants: string[]
}
