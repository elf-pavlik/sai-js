import {
  type AgentRegistrationData,
  BaseFactory,
  type BaseReadableFactory,
  type AccessDescriptionSetData,
  type AccessNeedDescriptionData,
  type AccessNeedGroupDescriptionData,
  type AccessNeedData,
  type AccessNeedGroupData,
  type AgentRegistryData,
  type ApplicationRegistrationData,
  type AuthorizationRegistryData,
  type DataAuthorizationData,
  type DataRegistrationData,
  type DataRegistryData,
  type FactoryDependencies,
  type FinalGrantData,
  type GrantData,
  type GrantRegistryData,
  type RegistrySetData,
  type RegistrySetDataInput,
  type RoleData,
  type RoleRegistryData,
  type SocialAgentInvitationData,
  type SocialAgentRegistrationData,
} from '.'
import {
  accessNeedDescriptionFromJsonLd,
  accessNeedGroupDescriptionFromJsonLd,
} from './access-description'
import { fromJsonLd as accessNeedFromJsonLd } from './access-need'
import { fromJsonLd as accessNeedGroupFromJsonLd } from './access-need-group'
import { fromJsonLd as dataAuthorizationFromJsonLd } from './data-authorization'
import { loadApplicationRegistration } from './crud/application-registration'
import { loadSocialAgentInvitation } from './crud/social-agent-invitation'
import { loadSocialAgentRegistration } from './crud/social-agent-registration'
import { loadRole } from './crud/role'
import { loadRegistrySet } from './crud/registry-set'

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
    data?: Omit<AgentRegistrationData, 'id'>
  ): Promise<ApplicationRegistrationData>
  socialAgentRegistration(
    iri: string,
    reciprocal?: boolean,
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
  registrySet(iri: string, data?: RegistrySetDataInput): Promise<RegistrySetData>
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
        data?: Omit<AgentRegistrationData, 'id'>
      ): Promise<ApplicationRegistrationData> {
        if (data) {
          const hasDataGrant = data.hasDataGrant ?? []
          return {
            ...data,
            id: iri,
            hasDataGrant,
            granted: hasDataGrant.length > 0,
          }
        }
        return loadApplicationRegistration(iri, factory)
      },
      socialAgentRegistration: async function socialAgentRegistration(
        iri: string,
        reciprocal = false,
        data?: Omit<SocialAgentRegistrationData, 'id' | 'hasAccessNeedGroup' | 'reciprocalRegistration'>
      ): Promise<SocialAgentRegistrationData> {
        if (data) {
          return { ...data, id: iri }
        }
        return loadSocialAgentRegistration(iri, factory, reciprocal)
      },
      socialAgentInvitation: async function socialAgentInvitation(
        iri: string,
        data?: Omit<SocialAgentInvitationData, 'id' | 'registeredAgent'>
      ): Promise<SocialAgentInvitationData> {
        if (data) {
          return { ...data, id: iri }
        }
        return loadSocialAgentInvitation(iri, factory)
      },
      role: async function role(
        iri: string,
        data?: Omit<RoleData, 'id'>
      ): Promise<RoleData> {
        if (data) {
          return { id: iri, label: data.label, members: data.members }
        }
        return loadRole(iri, factory)
      },
      roleRegistry: async function roleRegistry(
        iri: string
      ): Promise<RoleRegistryData> {
        return { id: iri }
      },
      dataRegistry: async function dataRegistry(
        iri: string
      ): Promise<DataRegistryData> {
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
      grantRegistry: async function grantRegistry(
        iri: string
      ): Promise<GrantRegistryData> {
        return { id: iri }
      },
      agentRegistry: async function agentRegistry(
        iri: string
      ): Promise<AgentRegistryData> {
        return { id: iri }
      },
      registrySet: async function registrySet(
        iri: string,
        data?: RegistrySetDataInput
      ): Promise<RegistrySetData> {
        return loadRegistrySet(iri, factory, data)
      },
    }
  }

  private immutableFactory(): ImmutableFactory {
    const factory = this
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
        const response = await factory.fetch.raw(iri, {
          headers: { Accept: 'application/ld+json' },
        })
        const doc = await response.json()
        return dataAuthorizationFromJsonLd(doc, iri)
      },
      accessNeedDescription: async function accessNeedDescription(
        iri: string
      ): Promise<AccessNeedDescriptionData> {
        const response = await factory.fetch.raw(iri, {
          headers: { Accept: 'application/ld+json' },
        })
        const doc = await response.json()
        return accessNeedDescriptionFromJsonLd(doc, iri)
      },
      accessNeedGroupDescription: async function accessNeedGroupDescription(
        iri: string
      ): Promise<AccessNeedGroupDescriptionData> {
        const response = await factory.fetch.raw(iri, {
          headers: { Accept: 'application/ld+json' },
        })
        const doc = await response.json()
        return accessNeedGroupDescriptionFromJsonLd(doc, iri)
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
        const response = await factory.fetch.raw(iri, {
          headers: { Accept: 'application/ld+json' },
        })
        const doc = await response.json()
        const need = await accessNeedFromJsonLd(doc, iri)
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
        const response = await factory.fetch.raw(iri, {
          headers: { Accept: 'application/ld+json' },
        })
        const doc = await response.json()
        const group = await accessNeedGroupFromJsonLd(doc, iri)
        group.accessNeeds = await Promise.all(
          group.hasAccessNeed.map((needIri) => factory.readable.accessNeed(needIri, descriptionLang))
        )
        return group
      },
      ...super.readableFactory(),
    }
  }
}
