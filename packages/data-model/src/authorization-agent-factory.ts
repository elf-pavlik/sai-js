import { INTEROP } from '@janeirodigital/interop-utils'
import {
  type AccessDescriptionSetData,
  type AccessNeedData,
  type AccessNeedDescriptionData,
  type AccessNeedGroupData,
  type AccessNeedGroupDescriptionData,
  type AgentRegistrationData,
  type AgentRegistryData,
  type ApplicationRegistrationData,
  type AuthorizationRegistryData,
  BaseFactory,
  type BaseReadableFactory,
  type DataAuthorizationData,
  type DataRegistrationData,
  type DataRegistryData,
  type FactoryDependencies,
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

interface AuthorizationAgentReadableFactory extends BaseReadableFactory {
  dataAuthorization(iri: string): Promise<DataAuthorizationData>
  accessNeedDescription(iri: string): Promise<AccessNeedDescriptionData>
  accessNeedGroupDescription(iri: string): Promise<AccessNeedGroupDescriptionData>
  accessDescriptionSet(iri: string): Promise<AccessDescriptionSetData>
  accessNeed(iri: string, descriptionLang?: string): Promise<AccessNeedData>
  accessNeedGroup(iri: string, descriptionLang?: string): Promise<AccessNeedGroupData>
}
interface CRUDFactory {
  applicationRegistration(
    iri: string,
    data?: Omit<AgentRegistrationData, 'id' | 'type'>
  ): Promise<ApplicationRegistrationData>
  socialAgentRegistration(
    iri: string,
    data?: Omit<SocialAgentRegistrationData, 'id' | 'hasAccessNeedGroup' | 'reciprocalRegistration'>
  ): Promise<SocialAgentRegistrationData>
  socialAgentInvitation(
    iri: string,
    data?: Omit<SocialAgentInvitationData, 'id' | 'registeredAgent'>
  ): Promise<SocialAgentInvitationData>
  role(iri: string, data?: Omit<RoleData, 'id'>): Promise<RoleData>
  roleRegistry(iri: string): Promise<RoleRegistryData>
  dataRegistry(iri: string): Promise<DataRegistryData>
  dataRegistration(iri: string, data?: DataRegistrationData): Promise<DataRegistrationData>
  authorizationRegistry(iri: string): Promise<AuthorizationRegistryData>
  grantRegistry(iri: string): Promise<GrantRegistryData>
  agentRegistry(iri: string): Promise<AgentRegistryData>
  registrySet(iri: string): Promise<RegistrySetData>
}

interface ImmutableFactory {
  dataGrant(iri: string, data: GrantData): FinalGrantData
}

export class AuthorizationAgentFactory extends BaseFactory {
  declare readable: AuthorizationAgentReadableFactory

  immutable: ImmutableFactory

  crud: CRUDFactory

  constructor(
    public webId: string,
    public agentId: string,
    dependencies: FactoryDependencies
  ) {
    super(dependencies)

    this.readable = this.readableFactory()
    this.immutable = this.immutableFactory()
    this.crud = this.crudFactory()
  }

  private crudFactory(): CRUDFactory {
    const factory = this
    return {
      applicationRegistration: async function applicationRegistration(
        iri: string,
        data?: Omit<AgentRegistrationData, 'id' | 'type'>
      ): Promise<ApplicationRegistrationData> {
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
        return loadApplicationRegistration(iri, factory.fetch)
      },
      socialAgentRegistration: async function socialAgentRegistration(
        iri: string,
        data?: Omit<
          SocialAgentRegistrationData,
          'id' | 'hasAccessNeedGroup' | 'reciprocalRegistration'
        >
      ): Promise<SocialAgentRegistrationData> {
        if (data) {
          return { ...data, id: iri }
        }
        return loadSocialAgentRegistration(iri, factory.fetch)
      },
      socialAgentInvitation: async function socialAgentInvitation(
        iri: string,
        data?: Omit<SocialAgentInvitationData, 'id' | 'registeredAgent'>
      ): Promise<SocialAgentInvitationData> {
        if (data) {
          return { ...data, id: iri }
        }
        return loadSocialAgentInvitation(iri, factory.fetch)
      },
      role: async function role(iri: string, data?: Omit<RoleData, 'id'>): Promise<RoleData> {
        if (data) {
          return { id: iri, prefLabel: data.prefLabel, members: data.members, type: data.type }
        }
        return loadRole(iri, factory.fetch)
      },
      roleRegistry: async function roleRegistry(iri: string): Promise<RoleRegistryData> {
        return { id: iri }
      },
      dataRegistry: async function dataRegistry(iri: string): Promise<DataRegistryData> {
        return { id: iri }
      },
      dataRegistration: async function dataRegistration(
        iri: string,
        data?: DataRegistrationData
      ): Promise<DataRegistrationData> {
        if (data) {
          return { ...data, id: iri }
        }
        return factory.readable.dataRegistration(iri)
      },
      authorizationRegistry: async function authorizationRegistry(
        iri: string
      ): Promise<AuthorizationRegistryData> {
        return { id: iri }
      },
      grantRegistry: async function grantRegistry(iri: string): Promise<GrantRegistryData> {
        return { id: iri }
      },
      agentRegistry: async function agentRegistry(iri: string): Promise<AgentRegistryData> {
        return { id: iri }
      },
      registrySet: async function registrySet(iri: string): Promise<RegistrySetData> {
        return loadRegistrySet(iri, factory)
      },
    }
  }

  private immutableFactory(): ImmutableFactory {
    return {
      dataGrant: function dataGrant(iri: string, data: GrantData): FinalGrantData {
        return { ...data, id: iri }
      },
    }
  }

  protected readableFactory() {
    const factory = this
    return {
      dataAuthorization: async function dataAuthorization(
        iri: string
      ): Promise<DataAuthorizationData> {
        return loadDataAuthorization(iri, factory.fetch)
      },
      accessNeedDescription: async function accessNeedDescription(
        iri: string
      ): Promise<AccessNeedDescriptionData> {
        return loadAccessNeedDescription(iri, factory.fetch)
      },
      accessNeedGroupDescription: async function accessNeedGroupDescription(
        iri: string
      ): Promise<AccessNeedGroupDescriptionData> {
        return loadAccessNeedGroupDescription(iri, factory.fetch)
      },
      accessDescriptionSet: async function accessDescriptionSet(
        iri: string
      ): Promise<AccessDescriptionSetData> {
        // the set's own data is only its identity; descriptions are
        // resolved on demand via loadDescriptions
        return { id: iri }
      },
      accessNeed: async function accessNeed(
        iri: string,
        descriptionLang?: string
      ): Promise<AccessNeedData> {
        const need = await loadAccessNeed(iri, factory.fetch)
        if (need.hasInheritingNeed.length) {
          need.children = await Promise.all(
            need.hasInheritingNeed.map((childIri) =>
              factory.readable.accessNeed(childIri, descriptionLang)
            )
          )
        }
        return need
      },
      accessNeedGroup: async function accessNeedGroup(
        iri: string,
        descriptionLang?: string
      ): Promise<AccessNeedGroupData> {
        const group = await loadAccessNeedGroup(iri, factory.fetch)
        group.accessNeeds = await Promise.all(
          group.hasAccessNeed.map((needIri) =>
            factory.readable.accessNeed(needIri, descriptionLang)
          )
        )
        return group
      },
      ...super.readableFactory(),
    }
  }
}
