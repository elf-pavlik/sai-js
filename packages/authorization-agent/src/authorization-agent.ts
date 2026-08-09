import {
  AgentRegistry,
  AuthorizationAgentFactory,
  AuthorizationRegistry,
  type DataAuthorizationData,
  type DataInstanceData,
  type DataRegistrationData,
  DataRegistry,
  type FinalDataAuthorizationData,
  type GeneratedGrants,
  type GrantData,
  type RegistrySetData,
  type RoleData,
  RoleRegistry,
  type ShapeTreeData,
  type WebIdProfileData,
  generateGrantsForAuthorization,
  getDataGrantIris,
  getDataGrants,
} from '@janeirodigital/interop-data-model'
import {
  INTEROP,
  SPACE,
  type WhatwgFetch,
  discoverStorageDescription,
  fetchJsonLd,
  findNodeIdByType,
} from '@janeirodigital/interop-utils'
import {
  type AccessAuthorizationStructure,
  type GrantedAuthorization,
  type NestedDataAuthorizationData,
  generateAuthorization,
} from './authorization'
interface AuthorizationAgentDependencies {
  fetch: WhatwgFetch
  randomUUID(): string
}

export interface AgentWithAccess {
  agent: string
  dataAuthorization: string
  accessMode: string[]
}

// TODO: duplicates ShareAuthorization from api-messages (sai-impl-service)
export type ShareDataInstanceStructure = {
  applicationId: string
  resource: string
  accessMode: string[]
  children: {
    shapeTree: string
    accessMode: string[]
  }[]
  agents: string[]
}

// TODO: adjust if registrations are not / nested in the registry
function registryOfRegistration(dataRegistrationIri: string): string {
  return `${dataRegistrationIri.split('/').slice(0, -2).join('/')}/`
}

function formatAgentWithAccess(dataAuthorization: DataAuthorizationData): AgentWithAccess {
  return {
    agent: dataAuthorization.grantee,
    dataAuthorization: dataAuthorization.id!,
    accessMode: dataAuthorization.accessMode,
  }
}

export class AuthorizationAgent {
  factory: AuthorizationAgentFactory

  fetch: WhatwgFetch

  webIdProfile: WebIdProfileData

  ownersIndex: { [key: string]: string } = {}

  registrySet: RegistrySetData

  constructor(
    public webId: string,
    public agentId: string,
    dependencies: AuthorizationAgentDependencies,
    public registrySetId?: string
  ) {
    this.fetch = dependencies.fetch
    this.factory = new AuthorizationAgentFactory(webId, agentId, {
      fetch: this.fetch,
      randomUUID: dependencies.randomUUID,
    })
  }

  get applicationRegistrations() {
    return AgentRegistry.applicationRegistrations(this.registrySet.hasAgentRegistry, this.factory)
  }

  public async findApplicationRegistration(iri: string) {
    return AgentRegistry.findApplicationRegistration(
      this.registrySet.hasAgentRegistry,
      this.factory,
      iri
    )
  }

  get socialAgentRegistrations() {
    return AgentRegistry.socialAgentRegistrations(this.registrySet.hasAgentRegistry, this.factory)
  }

  public async findSocialAgentRegistration(iri: string) {
    return AgentRegistry.findSocialAgentRegistration(
      this.registrySet.hasAgentRegistry,
      this.factory,
      iri
    )
  }

  get socialAgentInvitations() {
    return AgentRegistry.socialAgentInvitations(this.registrySet.hasAgentRegistry, this.factory)
  }

  get roles() {
    return RoleRegistry.roles(this.registrySet.hasRoleRegistry, this.factory)
  }

  public async findRole(iri: string): Promise<RoleData | undefined> {
    for await (const role of this.roles) {
      if (role.id === iri) {
        return role
      }
    }
  }

  public async findSocialAgentInvitation(iri: string) {
    return AgentRegistry.findSocialAgentInvitation(
      this.registrySet.hasAgentRegistry,
      this.factory,
      iri
    )
  }

  public async findDataRegistration(
    dataRegistryIri: string,
    shapeTree: string
  ): Promise<DataRegistrationData> {
    const dataRegistry = this.registrySet.hasDataRegistry.find(
      (registry) => registry.id === dataRegistryIri
    )
    let dataRegistration: DataRegistrationData
    for await (const registration of DataRegistry.registrations(dataRegistry, this.factory)) {
      if (registration.registeredShapeTree === shapeTree) {
        dataRegistration = registration
        break
      }
    }
    return dataRegistration
  }

  private async findResourceServerOwner(resourceServerId: string): Promise<string> {
    const cached = this.ownersIndex[resourceServerId]
    if (cached) return cached
    let ownerId: string
    for (const dataRegistry of this.registrySet.hasDataRegistry) {
      if ((await DataRegistry.storageIri(dataRegistry, this.factory)) === resourceServerId)
        ownerId = this.webId
    }
    if (!ownerId) {
      for await (const socialAgentRegistration of this.socialAgentRegistrations) {
        if (!socialAgentRegistration?.reciprocalRegistration) continue
        const reciprocalReg = await this.factory.crud.socialAgentRegistration(
          socialAgentRegistration.reciprocalRegistration
        )
        if ((await getDataGrantIris(reciprocalReg)).length === 0) continue
        const dataGrants = await getDataGrants(reciprocalReg, this.factory)
        const grant = dataGrants.find((dataGrant) => dataGrant.hasStorage === resourceServerId)
        if (grant) ownerId = socialAgentRegistration.registeredAgent
      }
    }
    this.ownersIndex[resourceServerId] = ownerId
  }

  public async findResourceOwner(resourceId: string): Promise<string> {
    // find storage root
    const storageDescriptionIri = await discoverStorageDescription(resourceId, this.fetch)
    const doc = await fetchJsonLd(storageDescriptionIri, this.fetch)
    const storageRoot = await findNodeIdByType(doc, SPACE.Storage.value, storageDescriptionIri)

    return this.findResourceServerOwner(storageRoot)
  }

  public async findGrantForResource(resourceId: string, ownerId: string): Promise<GrantData> {
    const socialAgentRegistration = await this.findSocialAgentRegistration(ownerId)
    const dataRegistrationIri = `${resourceId.split('/').slice(0, -1).join('/')}/`
    if (!socialAgentRegistration?.reciprocalRegistration) {
      throw new Error(`no reciprocal registration for ${ownerId}`)
    }
    const reciprocalReg = await this.factory.crud.socialAgentRegistration(
      socialAgentRegistration.reciprocalRegistration
    )
    const dataGrants = await getDataGrants(reciprocalReg, this.factory)
    return dataGrants.find((dataGrant) => dataGrant.hasDataRegistration === dataRegistrationIri)
  }

  public async findDataRegistrationForResource(resourceId: string): Promise<DataRegistrationData> {
    const registrationId = `${resourceId.split('/').slice(0, -1).join('/')}/`
    return this.factory.readable.dataRegistration(registrationId)
  }

  public async findShapeTreeForResource(resourceId: string): Promise<ShapeTreeData> {
    let shapeTreeId: string
    const ownerId = await this.findResourceOwner(resourceId)
    if (ownerId === this.webId) {
      const dataRegistration = await this.findDataRegistrationForResource(resourceId)
      shapeTreeId = dataRegistration.registeredShapeTree
    } else {
      const dataGrant = await this.findGrantForResource(resourceId, ownerId)
      shapeTreeId = dataGrant.registeredShapeTree
    }
    return this.factory.readable.shapeTree(shapeTreeId)
  }

  private async bootstrap(): Promise<void> {
    this.webIdProfile = await this.factory.readable.webIdProfile(this.webId)
    if (this.registrySetId) {
      this.registrySet = await this.factory.crud.registrySet(this.registrySetId)
    }
  }

  public static async build(
    webId: string,
    agentId: string,
    registrySetId: string,
    dependencies: AuthorizationAgentDependencies
    // TODO: reorder argumets
  ): Promise<AuthorizationAgent> {
    const instance = new AuthorizationAgent(webId, agentId, dependencies, registrySetId)
    await instance.bootstrap()
    return instance
  }

  /*
  /*
   * Sincle solid doesn't provide atomic transactions we should follow this order
   * 1. Create Data Authorizations (or reuse existing when possible)
   * 2. Update Authorization Registry in single request
   *   * a) Remove reference to prior Data Authorizations for the grantee
   *   * b) Add reference to new Data Authorizations
   * TODO: reuse existing Data Authorizations wherever possible - see Data Authorization tests
   */
  public async recordAccessAuthorization(
    authorization: AccessAuthorizationStructure,
    extendIfExists = false
  ): Promise<FinalDataAuthorizationData[]> {
    return generateAuthorization(
      authorization,
      this.webId,
      this.registrySet.hasAuthorizationRegistry,
      this.factory,
      extendIfExists
    )
  }

  public async generateDataGrants(
    dataAuthorizationIris: string[],
    grantee: string
  ): Promise<GeneratedGrants> {
    const dataAuthorizations = await Promise.all(
      dataAuthorizationIris.map((iri) => this.factory.readable.dataAuthorization(iri))
    )
    return generateGrantsForAuthorization(dataAuthorizations, this.registrySet, grantee)
  }

  public async findAuthorizationsForAgent(peerId: string): Promise<DataAuthorizationData[]> {
    const authorizations: DataAuthorizationData[] = []
    // TODO: optimize!
    const iterator = AuthorizationRegistry.dataAuthorizations(
      this.registrySet.hasAuthorizationRegistry,
      this.factory
    )
    for await (const dataAuthorization of iterator) {
      if (dataAuthorization.grantee === peerId) {
        authorizations.push(dataAuthorization)
      } else {
        for await (const role of this.roles) {
          if (dataAuthorization.grantee === role.id && role.members.includes(peerId)) {
            authorizations.push(dataAuthorization)
          }
        }
      }
    }
    return authorizations
  }

  public async findSocialAgentsWithAccess(dataInstanceIri: string): Promise<AgentWithAccess[]> {
    const agentsWithAccess = await this.findAgentsWithAccess(dataInstanceIri)
    const socialAgentsWithAccess: AgentWithAccess[] = []
    for await (const registration of this.socialAgentRegistrations) {
      const socialAgentWithAccess = agentsWithAccess.find(
        ({ agent }) => agent === registration.registeredAgent
      )
      if (socialAgentWithAccess) {
        socialAgentsWithAccess.push(socialAgentWithAccess)
      }
    }
    return socialAgentsWithAccess
  }

  public async findAgentsWithAccess(dataInstanceIri: string): Promise<AgentWithAccess[]> {
    const dataInstance = await this.factory.readable.dataInstance(dataInstanceIri)
    const shapeTree = dataInstance.dataRegistration!.registeredShapeTree
    const agentsWithAccess: AgentWithAccess[] = []
    const iterator = AuthorizationRegistry.dataAuthorizations(
      this.registrySet.hasAuthorizationRegistry,
      this.factory
    )
    for await (const dataAuthorization of iterator) {
      if (dataAuthorization.registeredShapeTree !== shapeTree) continue

      switch (dataAuthorization.scopeOfAuthorization) {
        case INTEROP.All.value:
          agentsWithAccess.push(formatAgentWithAccess(dataAuthorization))
          break
        case INTEROP.AllFromAgent.value:
          // TODO: rethink for delegated sharing, e.g. Alice shares project owned by ACME
          if (dataAuthorization.dataOwner === this.webId) {
            agentsWithAccess.push(formatAgentWithAccess(dataAuthorization))
          }
          break
        case INTEROP.AllFromRegistry.value:
          if (dataAuthorization.hasDataRegistration === dataInstance.dataRegistration!.id) {
            agentsWithAccess.push(formatAgentWithAccess(dataAuthorization))
          }
          break
        case INTEROP.SelectedFromRegistry.value:
          if (
            dataAuthorization.hasDataRegistration === dataInstance.dataRegistration!.id &&
            (dataAuthorization.hasDataInstance ?? []).includes(dataInstanceIri)
          ) {
            agentsWithAccess.push(formatAgentWithAccess(dataAuthorization))
          }
          break
        default:
          throw new Error(
            `encountered incorect Data Authorization with scope:${dataAuthorization.scopeOfAuthorization}`
          )
      }
    }
    return agentsWithAccess
  }

  private async formatAuthorization(
    agent: string,
    dataInstance: DataInstanceData,
    details: ShareDataInstanceStructure
  ): Promise<GrantedAuthorization> {
    const dataAuthorization: NestedDataAuthorizationData = {
      type: [INTEROP.DataAuthorization.value],
      grantee: agent,
      grantedBy: this.webId,
      registeredShapeTree: dataInstance.dataRegistration!.registeredShapeTree,
      scopeOfAuthorization: INTEROP.SelectedFromRegistry.value,
      dataOwner: this.webId, // TODO: delegated authorizations and trusted agents
      hasDataRegistration: dataInstance.dataRegistration!.id,
      accessMode: details.accessMode,
      hasDataInstance: [dataInstance.id],
      children: await Promise.all(
        details.children.map(async (child) => ({
          type: [INTEROP.DataAuthorization.value],
          grantee: agent,
          grantedBy: this.webId,
          registeredShapeTree: child.shapeTree,
          scopeOfAuthorization: INTEROP.Inherited.value,
          dataOwner: this.webId, // TODO: delegated authorizations and trusted agents
          hasDataRegistration: (
            await this.findDataRegistration(
              registryOfRegistration(dataInstance.dataRegistration!.id),
              child.shapeTree
            )
          ).id,
          accessMode: child.accessMode,
        }))
      ),
    }

    return {
      grantee: agent,
      granted: true,
      dataAuthorizations: [dataAuthorization],
    }
  }

  /*
   * Authorizes access to a specific Data Instance to multiple agents
   * TODO: support delegated authorization
   */
  public async shareDataInstance(
    details: ShareDataInstanceStructure
  ): Promise<FinalDataAuthorizationData[]> {
    // ensure owner doesn't grant acces for oneself
    // TODO: reconsider for TrustedGrants grantees, compare with data instance owner instead
    const requestedAgents = details.agents.filter((agent) => agent !== this.webId)
    // filter out agents who already have access
    // TODO: do we need to adjust once we handle access modes? or require separate operation for such change
    const agentsWithAccess = (await this.findSocialAgentsWithAccess(details.resource)).map(
      (obj) => obj.agent
    )
    const agents = requestedAgents.filter((agent) => !agentsWithAccess.includes(agent))

    // TODO: ensure all agents have social agent registrations, throw error

    const dataInstance = await this.factory.readable.dataInstance(details.resource)
    const authorizations = await Promise.all(
      agents.map(async (agent) => {
        const authorization = await this.formatAuthorization(agent, dataInstance, details)
        return this.recordAccessAuthorization(authorization, true)
      })
    )
    return authorizations.flat()
  }
}
