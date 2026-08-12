import type { WhatwgFetch } from '@janeirodigital/interop-utils'
import type { ApplicationId } from './application-registration'
import type { RoleId } from './crud/role'
import type { SocialAgentId } from './crud/social-agent-registration'

export interface FactoryDependencies {
  fetch: WhatwgFetch
  randomUUID(): string
}
export * from './crud'
export * from './templates'
export { ApplicationFactory } from './application-factory'
export { AuthorizationAgentFactory } from './authorization-agent-factory'
export type { DataInstanceData, ChildInfo } from './data-instance'
export type { ShapeTreeData, ShapeTreeId, ShapeTreeReference } from './shape-tree'
export * as ShapeTree from './shape-tree'
export type { AccessNeedData, AccessNeedId } from './access-need'
export * as AccessNeed from './access-need'
export type { AccessNeedGroupData, AccessNeedGroupId } from './access-need-group'
export * as AccessNeedGroup from './access-need-group'
export { dataModelContext, iriTermDef, linkedIrisJsonLd } from './context'
export type { GrantData, GrantId, FinalGrantData, GeneratedGrants } from './grant'
export * as Grant from './grant'
export { toJsonLd } from './grant'
export type {
  DataAuthorizationData,
  DataAuthorizationId,
  FinalDataAuthorizationData,
} from './data-authorization'
export * as DataAuthorization from './data-authorization'
export { generateGrantsForAuthorization } from './data-authorization'
export type { WebIdProfileData, WebIdProfileId } from './web-id-profile'
export * as WebIdProfile from './web-id-profile'
export type { ClientIdDocumentData, ClientIdDocumentId } from './client-id-document'
export * as ClientIdDocument from './client-id-document'
export type {
  ShapeTreeDescriptionData,
  ShapeTreeDescriptionId,
} from './shape-tree-description'
export * as ShapeTreeDescription from './shape-tree-description'
export type {
  AccessDescriptionData,
  AccessDescriptionId,
  AccessNeedDescriptionData,
  AccessNeedDescriptionId,
  AccessNeedGroupDescriptionData,
  AccessNeedGroupDescriptionId,
} from './access-description'
export * as AccessDescription from './access-description'
export type { AccessDescriptionSetData } from './access-description-set'
export * as AccessDescriptionSet from './access-description-set'
export type { DataRegistrationData, DataRegistrationId } from './data-registration'
export * as DataRegistration from './data-registration'
export type { ApplicationRegistrationData, ApplicationRegistrationId, ApplicationId } from './application-registration'
export * as ApplicationRegistration from './application-registration'
export type { DataOwnerData } from './data-owner'

// ──────────────────────────
// Boundary-facing identities
// ──────────────────────────

/** An agent identity: a social agent or an application. */
export type AgentId = SocialAgentId | ApplicationId

/** An agent or role identity (workflow boundaries route on `type`). */
export type AgentOrRoleId = AgentId | RoleId
