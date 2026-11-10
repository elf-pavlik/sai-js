import { registryStorageRoot } from '@janeirodigital/interop-utils'

/**
 * Typed revocation errors (C4 / D11).
 *
 * The grant boundary (`revokeGrantsClosure`) refuses a request before any
 * mutation; the refusal is a machine-readable code, never a message
 * substring. The grant boundary is HTTP-only (the owner `RevokeGrants` RPC was
 * deleted, D18): the handler maps the code to a status + JSON body. The
 * authorization leg's RPC maps its own `AuthorizationRevocationFailure`. No
 * `err.message.includes(...)` matching anywhere.
 */
export type RevocationErrorCode =
  /** the grant IRI resolves to no known registry pod (unknown resource) */
  | 'unknown'
  /** the listed grants do not belong to the revocation target's registry */
  | 'wrong-data-owner'
  /** the requester is neither the grantor nor the data owner (the grant boundary is grantor/owner only, D17) */
  | 'unauthorized'
  /** the chain predicate cannot derive a delegation for the grant */
  | 'not-delegable'
  /** the requested grants span more than one data owner's registry (B2) */
  | 'mixed-owner'

/**
 * A refusal at the grant boundary. `grants` carries the offending IRIs (the
 * whole requested set for `mixed-owner`, the specific grant otherwise) so
 * callers can echo a precise, machine-readable failure.
 */
export class RevocationError extends Error {
  readonly code: RevocationErrorCode
  readonly grants: string[]

  constructor(code: RevocationErrorCode, grants: readonly string[], message: string) {
    super(message)
    this.name = 'RevocationError'
    this.code = code
    this.grants = [...grants]
  }
}

export function isRevocationError(value: unknown): value is RevocationError {
  return value instanceof RevocationError
}

/**
 * The identifier a grant IRI groups by. Flat LWS storage makes the URI
 * independent of containment, so a flat member (`<registryPodRoot><uuid>`)
 * groups by the pod root while a hierarchical one
 * (`<registryContainer><id>`) groups by its path parent — both are the IRI
 * without its last path segment. Used to group/compare owners by the
 * **requested** set — before anything is loaded — which closes the B2 hole
 * (mixed-owner requests must fail as a whole, not partially apply the grants
 * that happened to load from one registry).
 */
export function grantRegistryOf(grantIri: string): string {
  const end = grantIri.lastIndexOf('/')
  return end === -1 ? grantIri : grantIri.slice(0, end + 1)
}

/** Normalize a registry container IRI to the trailing-slash form. */
export function normalizeRegistryIri(registryIri: string): string {
  return registryIri.endsWith('/') ? registryIri : `${registryIri}/`
}

/**
 * Whether a requested grant can be revoked through `registryIri`: its
 * grouping key is the registry itself (hierarchical member) or the registry's
 * storage root (flat member, whose IRI carries no registry segment).
 */
export function grantBelongsToRegistry(grantIri: string, registryIri: string): boolean {
  const target = normalizeRegistryIri(registryIri)
  const podRoot = registryStorageRoot(target)
  const group = normalizeRegistryIri(grantRegistryOf(grantIri))
  return group === target || group === podRoot
}
