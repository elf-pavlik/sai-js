import {
  type AgentRegistrationData,
  BaseFactory,
  type BaseReadableFactory,
  CRUDAgentRegistry,
  CRUDApplicationRegistration,
  CRUDAuthorizationRegistry,
  CRUDDataRegistration,
  CRUDDataRegistry,
  CRUDGrantRegistry,
  CRUDRegistrySet,
  CRUDRole,
  CRUDRoleRegistry,
  CRUDSocialAgentInvitation,
  CRUDSocialAgentRegistration,
  type AccessDescriptionSetData,
  type AccessNeedDescriptionData,
  type AccessNeedGroupDescriptionData,
  type DataAuthorizationData,
  type DataRegistrationData,
  type FactoryDependencies,
  type FinalGrantData,
  type GrantData,
  ReadableAccessNeed,
  ReadableAccessNeedGroup,
  type SocialAgentInvitationData,
  type SocialAgentRegistrationData,
} from '.'
import {
  accessNeedDescriptionFromJsonLd,
  accessNeedGroupDescriptionFromJsonLd,
} from './access-description'
import { fromJsonLd as dataAuthorizationFromJsonLd } from './data-authorization'
import type { CRUDRegistrySetData } from './crud/registry-set'
import type { CRUDData } from './crud/resource'

interface AuthorizationAgentReadableFactory extends BaseReadableFactory {
  dataAuthorization(iri: string): Promise<DataAuthorizationData>
  accessNeedDescription(iri: string): Promise<AccessNeedDescriptionData>
  accessNeedGroupDescription(iri: string): Promise<AccessNeedGroupDescriptionData>
  accessDescriptionSet(iri: string): Promise<AccessDescriptionSetData>
  accessNeed(iri: string, descriptionLang?: string): Promise<ReadableAccessNeed>
  accessNeedGroup(iri: string, descriptionLang?: string): Promise<ReadableAccessNeedGroup>
}
interface CRUDFactory {
  applicationRegistration(
    iri: string,
    data?: AgentRegistrationData
  ): Promise<CRUDApplicationRegistration>
  socialAgentRegistration(
    iri: string,
    reciprocal?: boolean,
    data?: SocialAgentRegistrationData
  ): Promise<CRUDSocialAgentRegistration>
  socialAgentInvitation(
    iri: string,
    data?: SocialAgentInvitationData
  ): Promise<CRUDSocialAgentInvitation>
  role(iri: string, data?: CRUDData): Promise<CRUDRole>
  roleRegistry(iri: string, data?: CRUDData): Promise<CRUDRoleRegistry>
  dataRegistry(iri: string, data?: CRUDData): Promise<CRUDDataRegistry>
  dataRegistration(iri: string, data?: DataRegistrationData): Promise<CRUDDataRegistration>
  authorizationRegistry(iri: string, data?: CRUDData): Promise<CRUDAuthorizationRegistry>
  grantRegistry(iri: string, data?: CRUDData): Promise<CRUDGrantRegistry>
  agentRegistry(iri: string, data?: CRUDData): Promise<CRUDAgentRegistry>
  registrySet(iri: string, data?: CRUDRegistrySetData): Promise<CRUDRegistrySet>
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
        data?: AgentRegistrationData
      ): Promise<CRUDApplicationRegistration> {
        return CRUDApplicationRegistration.build(iri, factory, data)
      },
      socialAgentRegistration: async function socialAgentRegistration(
        iri: string,

        reciprocal = false,
        data?: SocialAgentRegistrationData
      ): Promise<CRUDSocialAgentRegistration> {
        return CRUDSocialAgentRegistration.build(iri, factory, reciprocal, data)
      },
      socialAgentInvitation: async function socialAgentInvitation(
        iri: string,
        data?: SocialAgentInvitationData
      ): Promise<CRUDSocialAgentInvitation> {
        return CRUDSocialAgentInvitation.build(iri, factory, data)
      },
      role: async function role(
        iri: string,
        data?: CRUDData
      ): Promise<CRUDRole> {
        return CRUDRole.build(iri, factory, data)
      },
      roleRegistry: async function roleRegistry(
        iri: string,
        data?: CRUDData
      ): Promise<CRUDRoleRegistry> {
        return CRUDRoleRegistry.build(iri, factory, data)
      },
      dataRegistry: async function dataRegistry(
        iri: string,
        data?: CRUDData
      ): Promise<CRUDDataRegistry> {
        return CRUDDataRegistry.build(iri, factory, data)
      },
      dataRegistration: async function dataRegistration(
        iri: string,
        data?: DataRegistrationData
      ): Promise<CRUDDataRegistration> {
        return CRUDDataRegistration.build(iri, factory, data)
      },
      authorizationRegistry: async function authorizationRegistry(
        iri: string,
        data?: CRUDData
      ): Promise<CRUDAuthorizationRegistry> {
        return CRUDAuthorizationRegistry.build(iri, factory, data)
      },
      grantRegistry: async function grantRegistry(
        iri: string,
        data?: CRUDData
      ): Promise<CRUDGrantRegistry> {
        return CRUDGrantRegistry.build(iri, factory, data)
      },
      agentRegistry: async function agentRegistry(
        iri: string,
        data?: CRUDData
      ): Promise<CRUDAgentRegistry> {
        return CRUDAgentRegistry.build(iri, factory, data)
      },
      registrySet: async function registrySet(
        iri: string,
        data?: CRUDRegistrySetData
      ): Promise<CRUDRegistrySet> {
        return CRUDRegistrySet.build(iri, factory, data)
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
      ): Promise<ReadableAccessNeed> {
        return ReadableAccessNeed.build(iri, factory, descriptionLang)
      },
      accessNeedGroup: async function accessNeedGroup(
        iri: string,
        descriptionLang?: string
      ): Promise<ReadableAccessNeedGroup> {
        return ReadableAccessNeedGroup.build(iri, factory, descriptionLang)
      },
      ...super.readableFactory(),
    }
  }
}
