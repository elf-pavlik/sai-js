import { INTEROP, LWS, frameNode, selectNode, withContext } from '@janeirodigital/interop-utils'

import { grantContext } from './context.ts'

export type GrantId = {
  id?: string
  type: string[]
}

/** The LWS `access[].target` value object. */
export interface LwsTarget {
  type: string
  value: string[]
}

/** The LWS `access[]` policy node. */
export interface LwsAccessPolicy {
  type: string[]
  assignee: string
  action: string[]
  target: LwsTarget
}

/**
 * The canonical grant read model: the LWS `AccessGrant` truth (`storage`,
 * `access`) plus the SAI extension fields. The resource type is
 * `lws:AccessGrant`; the legacy flat fields are gone.
 */
export type GrantData = GrantId & {
  /** `lws:storage` — the data storage the grant is scoped to. */
  storage: string
  /** `lws:access` — assignee/action/target policies. */
  access: LwsAccessPolicy[]
  /** SAI extension fields. */
  grantedBy: string
  dataOwner: string
  registeredShapeTree: string
  hasDataRegistration: string
  scopeOfGrant: string
  hasDataInstance?: string[]
  inheritsFromGrant?: string // parent grant IRI (Inherited scope)
  hasInheritingGrant?: string[] // child grant IRIs
}

/** A grant that has been assigned its storage IRI. */
export type FinalGrantData = GrantData & Required<Pick<GrantData, 'id'>>

export interface GeneratedGrants {
  sourceGrants: FinalGrantData[]
  delegatedGrants: GrantData[]
}

const GRANT_TERMS = [
  'storage',
  'access',
  'grantedBy',
  'dataOwner',
  'registeredShapeTree',
  'hasDataRegistration',
  'scopeOfGrant',
  'hasDataInstance',
  'inheritsFromGrant',
  'hasInheritingGrant',
] as const

export async function fromJsonLd(doc: unknown, id: string): Promise<GrantData> {
  return selectNode(
    await frameNode(doc, grantContext, id, { access: { '@embed': '@always' } }),
    GRANT_TERMS
  ) as unknown as GrantData
}

/** The concrete grantee (`access[].assignee`). SAI writes one policy per grant. */
export function grantGrantee(grant: Pick<GrantData, 'access'>): string | undefined {
  return grant.access[0]?.assignee
}

/** Every action across the grant's access policies (deduped). */
export function grantAccessModes(grant: Pick<GrantData, 'access'>): string[] {
  return [...new Set(grant.access.flatMap((policy) => policy.action))]
}

/** Every target across the grant's access policies. */
export function grantTargets(grant: Pick<GrantData, 'access'>): LwsTarget[] {
  return grant.access.map((policy) => policy.target)
}

export interface GrantTargetInput {
  scopeOfGrant: string
  storage: string
  hasDataRegistration: string
  hasDataInstance?: string[]
}

/**
 * The closest LWS target for a grant's SAI scope (plan §2.4):
 *
 * - `SelectedFromRegistry` → `lws:DataResource` values from `hasDataInstance`
 * - `AllFromRegistry` → `lws:Container` value `hasDataRegistration`
 * - `AllFromAgent` → `lws:StorageResource` value `storage`
 * - `Inherited` → the child registration as a `lws:Container`. The parent's
 *   target is carried by the `interop:inheritsFromGrant` link; copying the
 *   parent target would require the parent body at write time (the child is
 *   stored as its own graph), and SAI clients use the extension fields for
 *   scope. Documented divergence from the plan's target table.
 */
export function grantTarget(input: GrantTargetInput): LwsTarget {
  switch (input.scopeOfGrant) {
    case INTEROP.SelectedFromRegistry:
      return { type: LWS.DataResource, value: [...(input.hasDataInstance ?? [])] }
    case INTEROP.AllFromAgent:
      return { type: LWS.StorageResource, value: [input.storage] }
    case INTEROP.AllFromRegistry:
    case INTEROP.Inherited:
      return { type: LWS.Container, value: [input.hasDataRegistration] }
    default:
      throw new Error(`Unknown scope: ${input.scopeOfGrant}`)
  }
}

/** Build the LWS access policy list for a grant. */
export function grantAccess(
  input: GrantTargetInput & { assignee: string; actions: readonly string[] }
): LwsAccessPolicy[] {
  return [
    {
      type: [LWS.AccessPolicy],
      assignee: input.assignee,
      action: [...input.actions],
      target: grantTarget(input),
    },
  ]
}

/**
 * Write a grant as an LWS `AccessGrant` RDF resource. Only the canonical
 * fields are written: `storage`, `access`, the SAI extension fields, and the
 * `lws:AccessGrant` type. The legacy flat fields are never emitted.
 */
export function toJsonLd(grant: FinalGrantData): Record<string, unknown> {
  const {
    id,
    type,
    storage,
    access,
    grantedBy,
    dataOwner,
    registeredShapeTree,
    hasDataRegistration,
    scopeOfGrant,
    hasDataInstance,
    inheritsFromGrant,
    hasInheritingGrant,
  } = grant
  return withContext(grantContext, {
    id,
    type: [...new Set([LWS.AccessGrant, ...(type ?? [])])],
    storage,
    access: access.map((policy) => ({
      type: policy.type,
      assignee: policy.assignee,
      action: policy.action,
      target: policy.target,
    })),
    grantedBy,
    dataOwner,
    registeredShapeTree,
    hasDataRegistration,
    scopeOfGrant,
    ...(hasDataInstance ? { hasDataInstance } : {}),
    ...(inheritsFromGrant ? { inheritsFromGrant } : {}),
    ...(hasInheritingGrant ? { hasInheritingGrant } : {}),
  })
}

export function dataRegistryIri(grant: GrantData): string {
  // `storage` is the data registry (pod) IRI and does not depend on the
  // registration's URI path — flat identifiers are directly under the pod.
  return grant.storage
}
