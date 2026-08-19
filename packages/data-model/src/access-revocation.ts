import { INTEROP } from '@janeirodigital/interop-utils'

/**
 * `interop:AccessRevocation` — the delegation-revocation request body
 * delivered to the data owner's delegation endpoint. `grants` carries **grant
 * IRIs only** — no grant bodies.
 */
export interface AccessRevocationMessage {
  type: string[]
  grants: string[]
}

/**
 * Narrow an unknown payload to an `AccessRevocationMessage`. `type` is
 * JSON-LD-idiomatic (`string[]`), but a plain type string is also accepted.
 */
export function isAccessRevocationMessage(payload: unknown): payload is AccessRevocationMessage {
  if (typeof payload !== 'object' || payload === null) return false
  const { grants, type } = payload as AccessRevocationMessage
  const types = Array.isArray(type) ? type : [type]
  return (
    types.includes(INTEROP.AccessRevocation) &&
    Array.isArray(grants) &&
    grants.every((grant) => typeof grant === 'string')
  )
}
