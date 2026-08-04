export { CRUDResource } from './resource'
export type { CRUDData } from './resource'
export { CRUDContainer } from './container'
export * from './agent-registration'
export * from './application-registration'
export * from './social-agent-registration'
export * from './social-agent-invitation'
export { CRUDDataRegistry } from './data-registry'
export * from './data-registration'
// explicit re-export to resolve getGranted ambiguity with ./agent-registration
// (getGranted remains exported from the authorization-registry module itself)
export {
  CRUDAuthorizationRegistry,
  getDataAuthorizationIris,
  getDataAuthorizations,
} from './authorization-registry'
export { CRUDGrantRegistry } from './grant-registry'
export { CRUDAgentRegistry } from './agent-registry'
export { CRUDRole } from './role'
export { CRUDRoleRegistry } from './role-registry'
export * from './registry-set'
