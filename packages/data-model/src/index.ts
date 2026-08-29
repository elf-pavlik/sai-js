import type { WhatwgFetch } from '@janeirodigital/interop-utils'
import type { ApplicationId } from './application-registration'
import type { RoleId } from './crud/role'
import type { SocialAgentId } from './crud/social-agent-registration'

/**
 * Plain dependencies for data-model functions (replaces the factories):
 * functions that read/write pass `fetch`; writers that assign new resource
 * IRIs (via `iriForContained`) pass the full `DataModelDependencies`.
 */
export interface DataModelDependencies {
  fetch: WhatwgFetch
  randomUUID(): string
}
export * from './crud'
export * from './templates'
export type { DataInstanceData, ChildInfo } from './data-instance'
export {
  childIris,
  computeChildren,
  frameDataInstance,
  frameDataInstanceFromDoc,
  isBlob,
  labelFromNode,
  loadDataInstance,
} from './data-instance'
export { loadDataAuthorization } from './data-authorization'
export { loadRole } from './crud/role'
export { loadRegistrySet } from './crud/registry-set'
export { loadSocialAgentRegistration } from './crud/social-agent-registration'
export { loadSocialAgentInvitation } from './crud/social-agent-invitation'
export type { ShapeTreeData, ShapeTreeId, ShapeTreeReference } from './shape-tree'
export * as ShapeTree from './shape-tree'
export { loadShapeTree } from './shape-tree'
export type { AccessNeedData, AccessNeedId } from './access-need'
export * as AccessNeed from './access-need'
export { loadAccessNeed, accessNeed } from './access-need'
export type { AccessNeedGroupData, AccessNeedGroupId } from './access-need-group'
export * as AccessNeedGroup from './access-need-group'
export { loadAccessNeedGroup, accessNeedGroup } from './access-need-group'
export {
  loadAccessNeedDescription,
  loadAccessNeedGroupDescription,
} from './access-description'
export { dataModelContext, iriTermDef, linkedIrisJsonLd } from './context'
export type { GrantData, GrantId, FinalGrantData, GeneratedGrants } from './grant'
export * as Grant from './grant'
export { toJsonLd, loadGrant } from './grant'
export type { AccessRequestMessage, IncomingGrantData } from './access-request'
export * as AccessRequest from './access-request'
export type { AccessRevocationMessage } from './access-revocation'
export * as AccessRevocation from './access-revocation'
export type {
  DataAuthorizationData,
  DataAuthorizationId,
  FinalDataAuthorizationData,
} from './data-authorization'
export * as DataAuthorization from './data-authorization'
export { generateGrantsForAuthorization } from './data-authorization'
export type { WebIdProfileData, WebIdProfileId } from './web-id-profile'
export * as WebIdProfile from './web-id-profile'
export { loadWebIdProfile } from './web-id-profile'
export type { ClientIdDocumentData, ClientIdDocumentId } from './client-id-document'
export * as ClientIdDocument from './client-id-document'
export { loadClientIdDocument } from './client-id-document'
export type {
  ShapeTreeDescriptionData,
  ShapeTreeDescriptionId,
} from './shape-tree-description'
export * as ShapeTreeDescription from './shape-tree-description'
export { loadShapeTreeDescription } from './shape-tree-description'
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
export { loadDataRegistration } from './data-registration'
export {
  type ApplicationRegistrationData,
  type ApplicationRegistrationId,
  ApplicationId,
} from './application-registration'
export * as ApplicationRegistration from './application-registration'
export { loadApplicationRegistration } from './application-registration'
export type { DataOwnerData } from './data-owner'

// ──────────────────────────
// Boundary-facing identities
// ──────────────────────────

/** An agent identity: a social agent or an application. */
export type AgentId = SocialAgentId | ApplicationId

/** An agent or role identity (workflow boundaries route on `type`). */
export type AgentOrRoleId = AgentId | RoleId
