import type { GrantData } from './grant'

/**
 * A grant as a grantor sends it inside an `AccessRequest`: the parent grant's
 * `hasInheritingGrant` carries **embedded child grant objects** (children are
 * created atomically in the same delegation request), not child IRIs.
 */
export type IncomingGrantData = Omit<GrantData, 'hasInheritingGrant'> & {
  hasInheritingGrant?: IncomingGrantData[]
}

/**
 * `interop:AccessRequest` — the delegation-issuance request body delivered to
 * the data owner's delegation endpoint. `grants` holds the top-level grant
 * objects, each embedding its `hasInheritingGrant` children.
 */
export interface AccessRequestMessage {
  type: string[]
  grants: IncomingGrantData[]
}

