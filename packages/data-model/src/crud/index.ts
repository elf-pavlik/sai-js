export { CRUDResource } from './resource'
export type { CRUDData } from './resource'
export { CRUDContainer } from './container'
export * from './agent-registration'
export {
  type ApplicationRegistrationData,
  createApplicationRegistration,
  loadApplicationRegistration,
} from './application-registration'
export {
  type SocialAgentRegistrationData,
  discoverReciprocal,
  discoverAndUpdateReciprocal,
  setAccessNeedGroup,
  createSocialAgentRegistration,
} from './social-agent-registration'
export {
  type SocialAgentInvitationData,
  setRegisteredAgent,
  updateSocialAgentInvitation,
} from './social-agent-invitation'
export { type RoleData } from './role'
export { createDataRegistration } from './data-registration'
// explicit re-export to resolve getGranted ambiguity with ./agent-registration
export {
  getDataAuthorizationIris,
  getDataAuthorizations,
} from './authorization-registry'
// registries are exported as namespaces to avoid colliding names
// (iriForContained is defined by every registry module)
export * as AgentRegistry from './agent-registry'
export * as RoleRegistry from './role-registry'
export * as DataRegistry from './data-registry'
export * as AuthorizationRegistry from './authorization-registry'
export * as GrantRegistry from './grant-registry'
export * as RegistrySet from './registry-set'
// registry POJO types stay top-level
export type { AgentRegistryData } from './agent-registry'
export type { RoleRegistryData } from './role-registry'
export type { DataRegistryData } from './data-registry'
export type { AuthorizationRegistryData } from './authorization-registry'
export type { GrantRegistryData } from './grant-registry'
export type { RegistrySetData, RegistrySetDataInput } from './registry-set'
