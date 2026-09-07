import type { ApplicationId } from './application-registration'
import type { RoleId } from './role'
import type { SocialAgentId } from './social-agent-registration'

export * from './agent-registration'
export type {
  ApplicationRegistrationData,
  ApplicationRegistrationId,
  ApplicationId,
} from './application-registration'
export {
  type SocialAgentRegistrationData,
  type SocialAgentRegistrationId,
  type SocialAgentId,
  getAdminGrantIris,
  toDataset,
} from './social-agent-registration'
export type {
  SocialAgentInvitationData,
  SocialAgentInvitationId,
} from './social-agent-invitation'
export * as SocialAgentInvitation from './social-agent-invitation'
export type { RoleData, RoleId } from './role'
export * as Role from './role'
// registries exported as namespaces to avoid colliding names
export type {
  SocialAgentRegistryData,
  ApplicationRegistryData,
  InvitationRegistryData,
} from './agent-registry'
export type { RoleRegistryData } from './role-registry'
export type { DataRegistryData } from './data-registry'
export type { AuthorizationRegistryData } from './authorization-registry'
export type { GrantRegistryData } from './grant-registry'
export type { ActivityRegistryData } from './activity-registry'
export * from './activities'
export * from './authorization-structures'
export * as RegistrySet from './registry-set'
export type { RegistrySetData } from './registry-set'
export * from './templates'
export type { DataInstanceData, ChildInfo } from './data-instance'
export {
  childIris,
  frameDataInstance,
  frameDataInstanceFromDoc,
  isBlob,
  labelFromNode,
} from './data-instance'
export { loadDataAuthorization } from './data-authorization'
export type { AdminAuthorizationData } from './admin-authorization'
export * as AdminAuthorization from './admin-authorization'
export { loadAdminAuthorization } from './admin-authorization'
export { loadRole } from './role'
export { loadRegistrySet } from './registry-set'
export { loadSocialAgentRegistration } from './social-agent-registration'
export { loadSocialAgentInvitation } from './social-agent-invitation'
export type { ShapeTreeData, ShapeTreeId, ShapeTreeReference } from './shape-tree'
export * as ShapeTree from './shape-tree'
export { loadShapeTree } from './shape-tree'
export type { AccessNeedData, AccessNeedId } from './access-need'
export * as AccessNeed from './access-need'
export { loadAccessNeed } from './access-need'
export type { AccessNeedGroupData, AccessNeedGroupId } from './access-need-group'
export * as AccessNeedGroup from './access-need-group'
export { loadAccessNeedGroup } from './access-need-group'
export { loadAccessNeedDescription } from './access-need-description'
export { loadAccessNeedGroupDescription } from './access-need-group-description'
export { dataModelContext } from './context'
export type { GrantData, GrantId, FinalGrantData, GeneratedGrants } from './grant'
export * as Grant from './grant'
export { toJsonLd, loadGrant } from './grant'
export type {
  AccessRequestMessage,
  IncomingGrantData,
  NeedBasedAccessRequestData,
  NeedBasedAccessRequestGroup,
  NeedBasedAccessRequestMessage,
} from './access-request'
export * as AccessRequest from './access-request'
export {
  fromJsonLd as AccessRequestFromJsonLd,
  loadNeedBasedAccessRequest,
} from './access-request'
export type { AccessRevocationMessage } from './access-revocation'
export * as AccessRevocation from './access-revocation'
export type {
  DataAuthorizationData,
  DataAuthorizationId,
  FinalDataAuthorizationData,
} from './data-authorization'
export * as DataAuthorization from './data-authorization'
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
export type { AccessDescriptionData, AccessDescriptionId } from './access-description'
export type { AccessNeedDescriptionData, AccessNeedDescriptionId } from './access-need-description'
export * as AccessNeedDescription from './access-need-description'
export type {
  AccessNeedGroupDescriptionData,
  AccessNeedGroupDescriptionId,
} from './access-need-group-description'
export * as AccessNeedGroupDescription from './access-need-group-description'
export type { DataRegistrationData, DataRegistrationId } from './data-registration'
export * as DataRegistration from './data-registration'
export { loadDataRegistration } from './data-registration'
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
