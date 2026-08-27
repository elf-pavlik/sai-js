import {
  AgentRegistry,
  AuthorizationAgentFactory,
  type DataAuthorizationData,
  type DataInstanceData,
  type DataRegistrationData,
  DataRegistry,
  type FinalDataAuthorizationData,
  type GeneratedGrants,
  type GrantData,
  type RegistrySetData,
  type RoleData,
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
  discoverAuthorizationAgent,
  discoverStorageDescription,
  fetchJsonLd,
  findNodeIdByType,
  getRegistrySetIri,
} from '@janeirodigital/interop-utils'
import {
  type AccessAuthorizationStructure,
  type GrantedAuthorization,
  type NestedDataAuthorizationData,
  generateAuthorization,
} from './authorization'
import {
  findApplicationRegistration as findApplicationRegistrationFromSparql,
  findRolesWithMember,
  findSocialAgentRegistration as findRegistrationFromSparql,
  getDataAuthorization as getDataAuthorizationFromSparql,
  getDataRegistration as getDataRegistrationFromSparql,
  getSocialAgentRegistration as getRegistrationFromSparql,
  getRole as getRoleFromSparql,
  listContained,
  listDataRegistrations,
  localSparqlTransport,
} from './sparql'
interface AuthorizationAgentDependencies {
  fetch: WhatwgFetch
  randomUUID(): string
  /** Internal SPARQL endpoint the session reads registry data from (org-context-sparql.md §2.3). */
  sparqlEndpoint: string
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

  /** Internal SPARQL endpoint (shared store) this session reads registry data from. */
  sparqlEndpoint: string

  webIdProfile: WebIdProfileData

  ownersIndex: { [key: string]: string } = {}

  registrySet: RegistrySetData

  /**
   * Registry sets keyed by webId (C2 of org-admin-feature.md): the session's
   * own is eager-loaded into `registrySet`; every other context's is
   * lazy-resolved on demand via `getRegistrySet` and cached here. Sessions are
   * short-lived (one per request / temporal activity), so this map needs no
   * cross-request invalidation.
   */
  registrySets: Map<string, RegistrySetData> = new Map()

  constructor(
    public webId: string,
    public agentId: string,
    dependencies: AuthorizationAgentDependencies,
    public registrySetId?: string
  ) {
    this.fetch = dependencies.fetch
    this.sparqlEndpoint = dependencies.sparqlEndpoint
    this.factory = new AuthorizationAgentFactory({
      fetch: this.fetch,
      randomUUID: dependencies.randomUUID,
    })
  }

  get applicationRegistrations() {
    return AgentRegistry.applicationRegistrations(this.registrySet.hasAgentRegistry, this.factory)
  }

  /**
   * The context registry's registration of application `registeredAgent`,
   * via the shared SPARQL query — the symmetric counterpart of
   * `findSocialAgentRegistration` over the
   * `interop:hasApplicationRegistration` predicate (docs/sparql.md step 3);
   * served per client-id by `AgentIdHandler`. Same query the services'
   * org-context counterpart runs against `/sparql-admin`.
   */
  public async findApplicationRegistration(iri: string, registrySet?: RegistrySetData) {
    return findApplicationRegistrationFromSparql(
      localSparqlTransport(this.sparqlEndpoint),
      (registrySet ?? this.registrySet).hasAgentRegistry.id,
      iri
    )
  }

  get socialAgentRegistrations() {
    return AgentRegistry.socialAgentRegistrations(this.registrySet.hasAgentRegistry, this.factory)
  }

  /**
   * The context registry's registration of `registeredAgent`, via the shared
   * SPARQL query — the session reads its own registry through the internal
   * endpoint (docs/sparql.md). The services' org-context counterpart
   * (`findSocialAgentRegistrationInContext` in components) runs the same
   * query against `/sparql-admin`.
   */
  public async findSocialAgentRegistration(registeredAgent: string, registrySet?: RegistrySetData) {
    return findRegistrationFromSparql(
      localSparqlTransport(this.sparqlEndpoint),
      (registrySet ?? this.registrySet).hasAgentRegistry.id,
      registeredAgent
    )
  }

  get socialAgentInvitations() {
    return AgentRegistry.socialAgentInvitations(this.registrySet.hasAgentRegistry, this.factory)
  }

  /**
   * Role by IRI — a single graph read (the role's own graph, keyed by its
   * IRI) via the shared SPARQL query, replacing the previous container
   * scan. The IRI targets the graph directly.
   */
  public async findRole(iri: string): Promise<RoleData | undefined> {
    return getRoleFromSparql(localSparqlTransport(this.sparqlEndpoint), iri)
  }

  public async findSocialAgentInvitation(iri: string) {
    return AgentRegistry.findSocialAgentInvitation(
      this.registrySet.hasAgentRegistry,
      this.factory,
      iri
    )
  }

  /**
   * The context's data registration for `shapeTree` in `dataRegistryIri` —
   * via the registry plane (docs/sparql.md step 4): `listDataRegistrations`
   * + one `getDataRegistration` graph read per registration (the
   * `hasDataRegistration` predicate in both graphs — the same listing the
   * HTTP `DataRegistry.registrations` iterator read). The container IRI
   * targets the graph directly.
   */
  public async findDataRegistration(
    dataRegistryIri: string,
    shapeTree: string
  ): Promise<DataRegistrationData> {
    const transport = localSparqlTransport(this.sparqlEndpoint)
    let dataRegistration: DataRegistrationData
    for (const iri of await listDataRegistrations(transport, dataRegistryIri)) {
      const registration = await getDataRegistrationFromSparql(transport, iri)
      if (registration.registeredShapeTree === shapeTree) {
        dataRegistration = registration
        break
      }
    }
    return dataRegistration
  }

  private async findResourceServerOwner(
    resourceServerId: string,
    ownerWebId?: string
  ): Promise<string> {
    const cached = this.ownersIndex[resourceServerId]
    if (cached) return cached
    // the registry set owning `resourceServerId` — the context owner in an
    // org context (class-C fix: was `this.webId`)
    const owner = ownerWebId ?? this.webId
    let ownerId: string
    // owned graphs come from this registry set; the resolved *owner identity*
    // is the context owner when provided (class-C)
    for (const dataRegistry of this.registrySet.hasDataRegistry) {
      if ((await DataRegistry.storageIri(dataRegistry, this.factory)) === resourceServerId)
        ownerId = owner
    }
    if (!ownerId) {
      for await (const socialAgentRegistration of this.socialAgentRegistrations) {
        if (!socialAgentRegistration?.reciprocalRegistration) continue
        const reciprocalReg = await this.factory.socialAgentRegistration(
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

  public async findResourceOwner(resourceId: string, ownerWebId?: string): Promise<string> {
    // find storage root
    const storageDescriptionIri = await discoverStorageDescription(resourceId, this.fetch)
    const doc = await fetchJsonLd(storageDescriptionIri, this.fetch)
    const storageRoot = await findNodeIdByType(doc, SPACE.Storage, storageDescriptionIri)

    return this.findResourceServerOwner(storageRoot, ownerWebId)
  }

  public async findGrantForResource(resourceId: string, ownerId: string): Promise<GrantData> {
    const socialAgentRegistration = await this.findSocialAgentRegistration(ownerId)
    const dataRegistrationIri = `${resourceId.split('/').slice(0, -1).join('/')}/`
    if (!socialAgentRegistration?.reciprocalRegistration) {
      throw new Error(`no reciprocal registration for ${ownerId}`)
    }
    const reciprocalReg = await this.factory.socialAgentRegistration(
      socialAgentRegistration.reciprocalRegistration
    )
    const dataGrants = await getDataGrants(reciprocalReg, this.factory)
    return dataGrants.find((dataGrant) => dataGrant.hasDataRegistration === dataRegistrationIri)
  }

  public async findDataRegistrationForResource(resourceId: string): Promise<DataRegistrationData> {
    const registrationId = `${resourceId.split('/').slice(0, -1).join('/')}/`
    return this.factory.dataRegistration(registrationId)
  }

  public async findShapeTreeForResource(
    resourceId: string,
    ownerWebId?: string
  ): Promise<ShapeTreeData> {
    let shapeTreeId: string
    const ownerId = await this.findResourceOwner(resourceId, ownerWebId)
    if (ownerId === (ownerWebId ?? this.webId)) {
      const dataRegistration = await this.findDataRegistrationForResource(resourceId)
      shapeTreeId = dataRegistration.registeredShapeTree
    } else {
      const dataGrant = await this.findGrantForResource(resourceId, ownerId)
      shapeTreeId = dataGrant.registeredShapeTree
    }
    return this.factory.shapeTree(shapeTreeId)
  }

  private async bootstrap(): Promise<void> {
    this.webIdProfile = await this.factory.webIdProfile(this.webId)
    if (this.registrySetId) {
      this.registrySet = await this.factory.registrySet(this.registrySetId)
    }
  }

  /**
   * Resolve the RegistrySet for a webId. The session's own registry set is
   * returned directly; any other webId's is discovered through that agent's
   * authorization-agent (agent-id) document — fetched with this session's
   * (authenticating agent's) fetch — via the admin-only
   * `Link: <registrySet>; rel="interop:hasRegistrySet"` response header
   * (served by AgentIdHandler), then loaded and cached per session.
   *
   * Federated case: the org's authorization agent may live on a different
   * server than the caller's — the org's AA serves the registry-set link and
   * the caller's fetch carries its own credentials, so the link is
   * authoritative across servers.
   */
  public async getRegistrySet(webId: string): Promise<RegistrySetData> {
    if (webId === this.webId) return this.registrySet
    const cached = this.registrySets.get(webId)
    if (cached) return cached
    const authorizationAgentIri = await discoverAuthorizationAgent(webId, this.fetch)
    if (!authorizationAgentIri) {
      throw new Error(`cannot discover authorization agent for ${webId}`)
    }
    const response = await this.fetch(authorizationAgentIri, { method: 'HEAD' })
    if (!response.ok) {
      throw new Error(`failed to fetch authorization agent for ${webId}: ${response.status}`)
    }
    const registrySetId = getRegistrySetIri(response.headers.get('Link') ?? '')
    if (!registrySetId) {
      throw new Error(`${webId} does not expose a registry set to this agent`)
    }
    const registrySet = await this.factory.registrySet(registrySetId)
    this.registrySets.set(webId, registrySet)
    return registrySet
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
      extendIfExists,
      this.sparqlEndpoint
    )
  }

  public async generateDataGrants(
    dataAuthorizationIris: string[],
    grantee: string
  ): Promise<GeneratedGrants> {
    const dataAuthorizations = await Promise.all(
      dataAuthorizationIris.map((iri) => this.factory.dataAuthorization(iri))
    )
    return generateGrantsForAuthorization(dataAuthorizations, this.registrySet, grantee)
  }

  public async findAuthorizationsForAgent(peerId: string): Promise<DataAuthorizationData[]> {
    // Registry plane (docs/sparql.md step 2): the authorization listing
    // reuses the same `listContained` + `getDataAuthorization` read
    // `findAgentsWithAccess` performs; role membership is one SELECT
    // (`findRolesWithMember`) — the former HTTP O(N×M) authorizations ×
    // roles sweep is gone. Non-DataAuthorizations (e.g. AdminAuthorizations
    // share the registry container) are type-filtered like the HTTP
    // `dataAuthorizations` iterator did.
    const transport = localSparqlTransport(this.sparqlEndpoint)
    const [iris, roleIris] = await Promise.all([
      listContained(transport, this.registrySet.hasAuthorizationRegistry.id),
      findRolesWithMember(transport, this.registrySet.hasRoleRegistry.id, peerId),
    ])
    const roleIriSet = new Set(roleIris)
    const authorizations = await Promise.all(
      iris.map((iri) => getDataAuthorizationFromSparql(transport, iri))
    )
    return authorizations.filter(
      (dataAuthorization) =>
        dataAuthorization.type.includes(INTEROP.DataAuthorization) &&
        (dataAuthorization.grantee === peerId || roleIriSet.has(dataAuthorization.grantee))
    )
  }

  public async findSocialAgentsWithAccess(dataInstanceIri: string): Promise<AgentWithAccess[]> {
    const agentsWithAccess = await this.findAgentsWithAccess(dataInstanceIri)
    const socialAgentsWithAccess: AgentWithAccess[] = []
    const transport = localSparqlTransport(this.sparqlEndpoint)
    const iris = await listContained(transport, this.registrySet.hasAgentRegistry.id)
    const registrations = await Promise.all(
      iris.map((iri) => getRegistrationFromSparql(transport, iri))
    )
    for (const registration of registrations) {
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
    const dataInstance = await this.factory.dataInstance(dataInstanceIri)
    const shapeTree = dataInstance.dataRegistration!.registeredShapeTree
    const agentsWithAccess: AgentWithAccess[] = []
    // the shared SPARQL listing over the authorization registry (same query
    // the org-context "who has access" uses) instead of the HTTP sweep
    const transport = localSparqlTransport(this.sparqlEndpoint)
    const iris = await listContained(transport, this.registrySet.hasAuthorizationRegistry.id)
    const authorizations = await Promise.all(
      iris.map((iri) => getDataAuthorizationFromSparql(transport, iri))
    )
    for (const dataAuthorization of authorizations) {
      if (dataAuthorization.registeredShapeTree !== shapeTree) continue

      switch (dataAuthorization.scopeOfAuthorization) {
        case INTEROP.All:
          agentsWithAccess.push(formatAgentWithAccess(dataAuthorization))
          break
        case INTEROP.AllFromAgent:
          // TODO: rethink for delegated sharing, e.g. Alice shares project owned by ACME
          if (dataAuthorization.dataOwner === this.webId) {
            agentsWithAccess.push(formatAgentWithAccess(dataAuthorization))
          }
          break
        case INTEROP.AllFromRegistry:
          if (dataAuthorization.hasDataRegistration === dataInstance.dataRegistration!.id) {
            agentsWithAccess.push(formatAgentWithAccess(dataAuthorization))
          }
          break
        case INTEROP.SelectedFromRegistry:
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
      type: [INTEROP.DataAuthorization],
      grantee: agent,
      grantedBy: this.webId,
      registeredShapeTree: dataInstance.dataRegistration!.registeredShapeTree,
      scopeOfAuthorization: INTEROP.SelectedFromRegistry,
      dataOwner: this.webId, // TODO: delegated authorizations and trusted agents
      hasDataRegistration: dataInstance.dataRegistration!.id,
      accessMode: details.accessMode,
      hasDataInstance: [dataInstance.id],
      children: await Promise.all(
        details.children.map(async (child) => ({
          type: [INTEROP.DataAuthorization],
          grantee: agent,
          grantedBy: this.webId,
          registeredShapeTree: child.shapeTree,
          scopeOfAuthorization: INTEROP.Inherited,
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
    details: ShareDataInstanceStructure,
    ownerWebId?: string
  ): Promise<FinalDataAuthorizationData[]> {
    // ensure owner doesn't grant acces for oneself (class-C fix: filter the
    // *context owner*, not the session's webId)
    // TODO: reconsider for TrustedGrants grantees, compare with data instance owner instead
    const owner = ownerWebId ?? this.webId
    const requestedAgents = details.agents.filter((agent) => agent !== owner)
    // filter out agents who already have access
    // TODO: do we need to adjust once we handle access modes? or require separate operation for such change
    const agentsWithAccess = (await this.findSocialAgentsWithAccess(details.resource)).map(
      (obj) => obj.agent
    )
    const agents = requestedAgents.filter((agent) => !agentsWithAccess.includes(agent))

    // TODO: ensure all agents have social agent registrations, throw error

    const dataInstance = await this.factory.dataInstance(details.resource)
    const authorizations = await Promise.all(
      agents.map(async (agent) => {
        const authorization = await this.formatAuthorization(agent, dataInstance, details)
        return this.recordAccessAuthorization(authorization, true)
      })
    )
    return authorizations.flat()
  }
}
