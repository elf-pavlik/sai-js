import { frameNode, selectNode, withContext } from '@janeirodigital/interop-utils'
import { dataModelContext } from './context'

export type DataAuthorizationId = {
  id?: string
  type: string[]
}

export type DataAuthorizationData = DataAuthorizationId & {
  grantee: string
  grantedBy: string
  registeredShapeTree: string
  scopeOfAuthorization: string
  dataOwner?: string
  hasDataRegistration?: string
  satisfiesAccessNeed?: string
  inheritsFromAuthorization?: string // parent data authorization IRI (Inherited scope)
  accessMode: string[]
  creatorAccessMode?: string[]
  hasDataInstance?: string[]
  // Children discovered via inverse quads in the dataset (lazily resolved)
  hasInheritingAuthorization?: string[] // child data authorization IRIs
}

/** A data authorization that has been assigned its IRI. */
export type FinalDataAuthorizationData = DataAuthorizationData &
  Required<Pick<DataAuthorizationData, 'id'>>

const DATA_AUTHORIZATION_TERMS = [
  'grantee',
  'grantedBy',
  'registeredShapeTree',
  'scopeOfAuthorization',
  'dataOwner',
  'hasDataRegistration',
  'satisfiesAccessNeed',
  'inheritsFromAuthorization',
  'accessMode',
  'creatorAccessMode',
  'hasDataInstance',
  'hasInheritingAuthorization',
]

export async function fromJsonLd(doc: unknown, id: string): Promise<DataAuthorizationData> {
  return selectNode(
    await frameNode(doc, dataModelContext, id),
    DATA_AUTHORIZATION_TERMS
  ) as unknown as DataAuthorizationData
}

export function toJsonLd(data: FinalDataAuthorizationData): Record<string, unknown> {
  return withContext(dataModelContext, data)
}
