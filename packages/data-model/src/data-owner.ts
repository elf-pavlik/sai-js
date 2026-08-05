import { ReadableDataRegistrationProxy, type GrantData, type BaseFactory } from '.'

// ──────────────────────────
// Types
// ──────────────────────────

/** Plain JSON representation of a data owner. */
export type DataOwnerData = {
  iri: string
  issuedGrants: GrantData[]
}

// ──────────────────────────
// Behavior functions (replacing class methods)
// ──────────────────────────

/**
 * Select the data registration proxies for a given shape tree among the
 * grants issued to this owner.
 * @param owner data owner
 * @param shapeTree URL of shape tree
 * @param factory factory used to create proxies
 * @returns Array of data registration proxies for that shape tree
 */
export function selectRegistrations(
  owner: DataOwnerData,
  shapeTree: string,
  factory: BaseFactory
): ReadableDataRegistrationProxy[] {
  return owner.issuedGrants
    .filter((sourceGrant) => sourceGrant.registeredShapeTree === shapeTree)
    .map((grant) => new ReadableDataRegistrationProxy(grant, factory))
}
