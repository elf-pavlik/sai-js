import type { RdfFetch } from '@janeirodigital/interop-utils'
import type { ApplicationFactory } from './application-factory'
import type { AuthorizationAgentFactory } from './authorization-agent-factory'

export interface FactoryDependencies {
  fetch: RdfFetch
  randomUUID(): string
}
export * from './base-factory'
export * from './crud'
export * from './templates'
export { ApplicationFactory } from './application-factory'
export { AuthorizationAgentFactory } from './authorization-agent-factory'
export type InteropFactory = ApplicationFactory | AuthorizationAgentFactory
export type { DataInstanceData, ChildInfo } from './data-instance'
export type { ShapeTreeData, ShapeTreeReference } from './shape-tree'
export * as ShapeTree from './shape-tree'
export type { AccessNeedData } from './access-need'
export * as AccessNeed from './access-need'
export type { AccessNeedGroupData } from './access-need-group'
export * as AccessNeedGroup from './access-need-group'
export type { GrantData, FinalGrantData, GeneratedGrants } from './grant'
export * as Grant from './grant'
export { toJsonLd } from './grant'
export { default as grantContext } from './grant-context'
export type { DataAuthorizationData, FinalDataAuthorizationData } from './data-authorization'
export * as DataAuthorization from './data-authorization'
export { generateGrantsForAuthorization } from './data-authorization'
export { default as dataAuthorizationContext } from './data-authorization-context'
export type { WebIdProfileData } from './web-id-profile'
export * as WebIdProfile from './web-id-profile'
export type { ClientIdDocumentData } from './client-id-document'
export * as ClientIdDocument from './client-id-document'
export type { ShapeTreeDescriptionData } from './shape-tree-description'
export * as ShapeTreeDescription from './shape-tree-description'
export type {
  AccessDescriptionData,
  AccessNeedDescriptionData,
  AccessNeedGroupDescriptionData,
} from './access-description'
export * as AccessDescription from './access-description'
export type { AccessDescriptionSetData } from './access-description-set'
export * as AccessDescriptionSet from './access-description-set'
export type { DataRegistrationData } from './data-registration'
export * as DataRegistration from './data-registration'
export type { ApplicationRegistrationData } from './application-registration'
export * as ApplicationRegistration from './application-registration'
export type { DataOwnerData } from './data-owner'
export * from './jsonld-utils'
