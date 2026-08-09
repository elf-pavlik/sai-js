import { INTEROP } from '@janeirodigital/interop-utils'
import {
  type AccessDescriptionSetData,
  type AccessNeedData,
  type AccessNeedDescriptionData,
  type AccessNeedGroupData,
  type AccessNeedGroupDescriptionData,
  type AgentRegistrationData,
  type AgentRegistryData,
  ApplicationFactory,
  type ApplicationRegistrationData,
  type AuthorizationRegistryData,
  type DataAuthorizationData,
  type DataRegistrationData,
  type DataRegistryData,
  type FinalGrantData,
  type GrantData,
  type GrantRegistryData,
  type RegistrySetData,
  type RoleData,
  type RoleRegistryData,
  type SocialAgentInvitationData,
  type SocialAgentRegistrationData,
} from '.'
import { loadAccessNeedDescription, loadAccessNeedGroupDescription } from './access-description'
import { loadAccessNeed } from './access-need'
import { loadAccessNeedGroup } from './access-need-group'
import { loadApplicationRegistration } from './application-registration'
import { loadRegistrySet } from './crud/registry-set'
import { loadRole } from './crud/role'
import { loadSocialAgentInvitation } from './crud/social-agent-invitation'
import { loadSocialAgentRegistration } from './crud/social-agent-registration'
import { loadDataAuthorization } from './data-authorization'
import { loadDataRegistration } from './data-registration'
import { loadGrant } from './grant'

/**
 * The authorization-agent-side factory: everything `ApplicationFactory`
 * provides, plus the authorization-agent structures. Methods with an
 * optional `data` argument create the POJO from data when given, and
 * read it from the wire otherwise — the factory only creates structures,
 * writes live in the `crud/*` and component modules.
 */
export class AuthorizationAgentFactory extends ApplicationFactory {
  applicationRegistration = async (
    iri: string,
    data?: Omit<AgentRegistrationData, 'id' | 'type'>
  ): Promise<ApplicationRegistrationData> => {
    if (data) {
      const hasDataGrant = data.hasDataGrant ?? []
      return {
        ...data,
        id: iri,
        type: [INTEROP.ApplicationRegistration],
        hasDataGrant,
        granted: hasDataGrant.length > 0,
      }
    }
    return loadApplicationRegistration(iri, this.fetch)
  }

  socialAgentRegistration = async (
    iri: string,
    data?: Omit<SocialAgentRegistrationData, 'id' | 'hasAccessNeedGroup' | 'reciprocalRegistration'>
  ): Promise<SocialAgentRegistrationData> => {
    if (data) {
      return { ...data, id: iri }
    }
    return loadSocialAgentRegistration(iri, this.fetch)
  }

  socialAgentInvitation = async (
    iri: string,
    data?: Omit<SocialAgentInvitationData, 'id' | 'registeredAgent'>
  ): Promise<SocialAgentInvitationData> => {
    if (data) {
      return { ...data, id: iri }
    }
    return loadSocialAgentInvitation(iri, this.fetch)
  }

  role = async (iri: string, data?: Omit<RoleData, 'id'>): Promise<RoleData> => {
    if (data) {
      return { id: iri, prefLabel: data.prefLabel, members: data.members, type: data.type }
    }
    return loadRole(iri, this.fetch)
  }

  roleRegistry = async (iri: string): Promise<RoleRegistryData> => ({ id: iri })

  dataRegistry = async (iri: string): Promise<DataRegistryData> => ({ id: iri })

  dataRegistration = async (
    iri: string,
    data?: DataRegistrationData
  ): Promise<DataRegistrationData> => {
    if (data) {
      return { ...data, id: iri }
    }
    return loadDataRegistration(iri, this.fetch)
  }

  authorizationRegistry = async (iri: string): Promise<AuthorizationRegistryData> => ({
    id: iri,
  })

  grantRegistry = async (iri: string): Promise<GrantRegistryData> => ({ id: iri })

  agentRegistry = async (iri: string): Promise<AgentRegistryData> => ({ id: iri })

  registrySet = async (iri: string): Promise<RegistrySetData> => loadRegistrySet(iri, this)

  dataGrant(iri: string, data: GrantData): FinalGrantData
  dataGrant(iri: string): Promise<GrantData>
  dataGrant(iri: string, data?: GrantData): FinalGrantData | Promise<GrantData> {
    if (data) {
      return { ...data, id: iri }
    }
    return loadGrant(iri, this.fetch)
  }

  dataAuthorization = async (iri: string): Promise<DataAuthorizationData> =>
    loadDataAuthorization(iri, this.fetch)

  accessNeedDescription = async (iri: string): Promise<AccessNeedDescriptionData> =>
    loadAccessNeedDescription(iri, this.fetch)

  accessNeedGroupDescription = async (iri: string): Promise<AccessNeedGroupDescriptionData> =>
    loadAccessNeedGroupDescription(iri, this.fetch)

  accessDescriptionSet = async (iri: string): Promise<AccessDescriptionSetData> => {
    // the set's own data is only its identity; descriptions are
    // resolved on demand via loadDescriptions
    return { id: iri }
  }

  accessNeed = async (iri: string, descriptionLang?: string): Promise<AccessNeedData> => {
    const need = await loadAccessNeed(iri, this.fetch)
    if (need.hasInheritingNeed.length) {
      need.children = await Promise.all(
        need.hasInheritingNeed.map((childIri) => this.accessNeed(childIri, descriptionLang))
      )
    }
    return need
  }

  accessNeedGroup = async (iri: string, descriptionLang?: string): Promise<AccessNeedGroupData> => {
    const group = await loadAccessNeedGroup(iri, this.fetch)
    group.accessNeeds = await Promise.all(
      group.hasAccessNeed.map((needIri) => this.accessNeed(needIri, descriptionLang))
    )
    return group
  }
}
