import type { GrantData } from '../grant'

export type DataGrant = GrantData
export type { GrantData }

// POJO type aliases kept during migration
export type { WebIdProfileData } from '../web-id-profile'
export type { ClientIdDocumentData } from '../client-id-document'
export type { ShapeTreeDescriptionData } from '../shape-tree-description'
export type {
  AccessDescriptionData,
  AccessNeedDescriptionData,
  AccessNeedGroupDescriptionData,
} from '../access-description'
export type { AccessDescriptionSetData } from '../access-description-set'
export type { DataRegistrationData } from '../data-registration'
export type { ApplicationRegistrationData } from '../application-registration'
export type { ShapeTreeData, ShapeTreeReference } from '../shape-tree'
export type { AccessNeedData } from '../access-need'
export type { AccessNeedGroupData } from '../access-need-group'
export type { DataInstanceData, ChildInfo } from '../data-instance'

export { ReadableResource } from './resource'
