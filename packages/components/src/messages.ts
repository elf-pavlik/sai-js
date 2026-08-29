import {
  type AccessRequestMessage,
  type AccessRevocationMessage,
} from '@janeirodigital/interop-data-model'
import { INTEROP } from '@janeirodigital/interop-utils'

// ──────────────────────────
// Delegation-endpoint message guards
// ──────────────────────────
// Moved here from the data-model package (decision Q4): the message *types*
// stay in data-model (`AccessRequestMessage`, `IncomingGrantData`,
// `AccessRevocationMessage`); the guards are consumption-side validation and
// only GrantIssuanceHandler (this package) uses them.

/**
 * Narrow an unknown payload to an `AccessRequestMessage`. `type` is
 * JSON-LD-idiomatic (`string[]`), but a plain type string is also accepted.
 */
export function isAccessRequestMessage(payload: unknown): payload is AccessRequestMessage {
  if (typeof payload !== 'object' || payload === null) return false
  const { grants, type } = payload as AccessRequestMessage
  const types = Array.isArray(type) ? type : [type]
  return types.includes(INTEROP.AccessRequest) && Array.isArray(grants)
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