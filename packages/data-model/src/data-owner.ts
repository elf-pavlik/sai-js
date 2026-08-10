import type { GrantData } from '.'

// ──────────────────────────
// Types
// ──────────────────────────

/** Plain JSON representation of a data owner. */
export type DataOwnerData = {
  iri: string
  issuedGrants: GrantData[]
}
