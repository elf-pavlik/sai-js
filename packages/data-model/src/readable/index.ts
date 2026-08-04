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

export { ReadableResource } from './resource'
export { ReadableContainer } from './container'
export { ReadableApplicationRegistration } from './application-registration'
export { ReadableShapeTree } from './shape-tree'
export { ReadableDataRegistration } from './data-registration'
export { ReadableAccessNeed } from './access-need'
export { ReadableAccessNeedGroup } from './access-need-group'
export { ReadableDataInstance } from './data-instance'
