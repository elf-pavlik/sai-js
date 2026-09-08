import type { WhatwgFetch } from '@janeirodigital/interop-utils'
import { fetchJsonLd, frameDoc } from '@janeirodigital/interop-utils'
import { dataModelContext } from './context'
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

/** The embedded access need group of a need-based access request — the
 *  framed group node (Project + inherited needs; descriptions follow-up). The
 *  values are (expanded-form) IRIs — bare class names are NOT expanded by
 *  `dataModelContext`, so the payload carries full IRIs for `type`,
 *  `registeredShapeTree`, `required` and `accessMode`. */
export type NeedBasedAccessRequestGroup = {
  id: string
  type: string[]
  hasAccessNeed: unknown[]
}

/**
 * `interop:NeedBasedAccessRequest` — the need-based access request delivered
 * to the data owner's (reused) delegation endpoint
 * (authorization-granting.md §6.1). **Distinct from** the delegation
 * `AccessRequest` (`grants`) / `AccessRevocation` — this one carries
 * `grantee`/`grantedBy`/`dataOwner` + the embedded access need group.
 */
/**
 * The stored need-based access request — the immutable resource the
 * owner-side workflow materializes in the AccessRequestRegistry
 * (authorization-granting.md §6.3). `hasAccessNeedGroup` holds the embedded
 * (framed) group — no status field: granting only ever REFERENCES the
 * request, dataOwner's registry never mutates it.
 */
export interface NeedBasedAccessRequestData {
  id: string
  type: string[]
  grantee: string
  grantedBy: string
  dataOwner: string
  hasAccessNeedGroup: NeedBasedAccessRequestGroup
}

export interface NeedBasedAccessRequestMessage {
  type: string[]
  grantee: string
  grantedBy: string
  dataOwner: string
  hasAccessNeedGroup: NeedBasedAccessRequestGroup
}

/**
 * Frame a stored AccessRequest document into `NeedBasedAccessRequestData`
 * (authorization-granting.md §6.3). The embedded group node is EMBEDDED
 * (`hasAccessNeedGroup` is `@type: '@id'`-coerced, so the default framing
 * would return only its id string) and normalized like the activity read —
 * a single `rdf:type` frames as a scalar, so `type` goes through the
 * array-form.
 */
export async function fromJsonLd(doc: unknown, id: string): Promise<NeedBasedAccessRequestData> {
  const node = (await frameDoc(doc, dataModelContext, id, {
    hasAccessNeedGroup: {
      '@embed': '@always',
      hasAccessNeed: {
        '@embed': '@always',
        hasInheritingNeed: { '@embed': '@always' },
      },
    },
  })) as {
    type?: unknown
    grantee?: unknown
    grantedBy?: unknown
    dataOwner?: unknown
    hasAccessNeedGroup?: { id?: unknown; type?: unknown; hasAccessNeed?: unknown }
  }
  const group = node.hasAccessNeedGroup
  return {
    id,
    type: node.type ? (Array.isArray(node.type) ? node.type : [node.type]) : [],
    grantee: node.grantee as string,
    grantedBy: node.grantedBy as string,
    dataOwner: node.dataOwner as string,
    hasAccessNeedGroup: {
      id: group?.id as string,
      type: group?.type ? (Array.isArray(group.type) ? group.type : [group.type]) : [],
      hasAccessNeed: group?.hasAccessNeed ?? [],
    },
  }
}

/** Load a stored AccessRequest from the owner's AccessRequestRegistry. */
export async function loadNeedBasedAccessRequest(
  id: string,
  fetch: WhatwgFetch
): Promise<NeedBasedAccessRequestData> {
  return fromJsonLd(await fetchJsonLd(id, fetch), id)
}

