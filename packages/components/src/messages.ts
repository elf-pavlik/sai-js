import type { AccessRevocationMessage } from '@janeirodigital/interop-data-model'
import { INTEROP } from '@janeirodigital/interop-utils'

// ──────────────────────────
// Access request message guards
// ──────────────────────────

/**
 * Narrow an unknown payload to an `AccessRevocationMessage`. `type` is
 * JSON-LD-idiomatic (`string[]`), but a plain type string is also accepted.
 */
export function isAccessRevocationMessage(payload: unknown): payload is AccessRevocationMessage {
  if (typeof payload !== 'object' || payload === null) return false
  const { grants, type } = payload as AccessRevocationMessage
  const types = Array.isArray(type) ? type : [type]
  return (
    (types.includes(INTEROP.AccessRevocationRequest) ||
      types.includes('AccessRevocationRequest')) &&
    Array.isArray(grants) &&
    grants.every((grant) => typeof grant === 'string')
  )
}
