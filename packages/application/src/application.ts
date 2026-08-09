import {
  ApplicationFactory,
  ApplicationRegistration,
  type ApplicationRegistrationData,
  type DataOwnerData,
  Grant,
} from '@janeirodigital/interop-data-model'
import { INTEROP } from '@janeirodigital/interop-utils'
import {
  ACL,
  type WhatwgFetch,
  discoverAgentRegistration,
  discoverAuthorizationAgent,
  discoverAuthorizationRedirectEndpoint,
  discoverDescriptionResource,
} from '@janeirodigital/interop-utils'

interface ApplicationDependencies {
  fetch: WhatwgFetch
  randomUUID(): string
}

type ParentInfo = {
  id: string
  scope: string
  resourceServer: string
}

type ChildInfo = {
  id: string
  scope: string
  resourceServer: string
  parent: string
}

export class Application {
  factory: ApplicationFactory

  fetch: WhatwgFetch

  authorizationAgentIri: string

  authorizationRedirectEndpoint: string

  registrationIri: string

  // TODO rename
  hasApplicationRegistration?: ApplicationRegistrationData

  public parentMap: Map<string, ParentInfo> = new Map()

  public childMap: Map<string, ChildInfo> = new Map()

  constructor(
    public webId: string,
    public applicationId: string,
    dependencies: ApplicationDependencies
  ) {
    this.fetch = dependencies.fetch
    this.factory = new ApplicationFactory({
      fetch: this.fetch,
      randomUUID: dependencies.randomUUID,
    })
  }

  private async bootstrap(): Promise<void> {
    this.authorizationAgentIri = await discoverAuthorizationAgent(this.webId, this.fetch)
    this.registrationIri = await discoverAgentRegistration(this.authorizationAgentIri, this.fetch)
    this.authorizationRedirectEndpoint = await discoverAuthorizationRedirectEndpoint(
      this.authorizationAgentIri,
      this.fetch
    )
    if (!this.registrationIri) return
    await this.buildRegistration()
  }

  public async buildRegistration(): Promise<void> {
    if (this.registrationIri) {
      this.hasApplicationRegistration = await this.factory.readable.applicationRegistration(
        this.registrationIri
      )
    }
  }

  get authorizationRedirectUri(): string {
    return `${this.authorizationRedirectEndpoint}?client_id=${encodeURIComponent(this.applicationId)}`
  }

  getShareUri(resourceIri: string): string {
    return `${this.authorizationRedirectEndpoint}?resource=${encodeURIComponent(
      resourceIri
    )}&client_id=${encodeURIComponent(this.applicationId)}`
  }

  static async build(
    webId: string,
    applicationId: string,
    dependencies: ApplicationDependencies
  ): Promise<Application> {
    const application = new Application(webId, applicationId, dependencies)
    await application.bootstrap()
    return application
  }

  /**
   * Array of DataOwner instances out of all the data application can access.
   * @public
   */
  get dataOwners(): DataOwnerData[] {
    if (!this.hasApplicationRegistration) return []
    // Note: this is now lazy — fetches data grants each time
    // The property access pattern changed from sync to async.
    // Consumers should use getDataOwnersAsync() instead.
    return []
  }

  public async getDataOwnersAsync(): Promise<DataOwnerData[]> {
    if (!this.hasApplicationRegistration) return []
    const dataGrants = await ApplicationRegistration.getDataGrants(
      this.hasApplicationRegistration,
      this.factory
    )
    return dataGrants.reduce((acc, grant) => {
      let owner: DataOwnerData = acc.find((agent) => agent.iri === grant.dataOwner)
      if (!owner) {
        owner = { iri: grant.dataOwner, issuedGrants: [] }
        acc.push(owner)
      }
      owner.issuedGrants.push(grant)
      return acc
    }, [] as DataOwnerData[])
  }

  public async resourceOwners(): Promise<Set<string>> {
    const owners = await this.getDataOwnersAsync()
    return new Set(owners.map((dataOwner) => dataOwner.iri))
  }

  public async resourceServers(resourceOwner: string, scope: string): Promise<Set<string>> {
    const owners = await this.getDataOwnersAsync()
    const dataOwner = owners.find((owner) => owner.iri === resourceOwner)
    if (!dataOwner) return new Set()
    const grants = dataOwner.issuedGrants.filter((grant) => grant.registeredShapeTree === scope)
    return new Set(grants.map((grant) => grant.hasStorage))
  }

  private async findGrant(storage: string, scope: string) {
    const owners = await this.getDataOwnersAsync()
    return owners
      .flatMap((owner) => owner.issuedGrants)
      .find(
        (dataGrant) => dataGrant.hasStorage === storage && dataGrant.registeredShapeTree === scope
      )
  }

  public async resources(resourceServer: string, scope: string): Promise<Set<string>> {
    const grant = await this.findGrant(resourceServer, scope)
    if (!grant) throw new Error('No grant found')
    let list: string[] = []
    if (grant.scopeOfGrant === INTEROP.Inherited) {
      throw new Error('Cannot list instances from Inherited grants')
    }
    if (grant.scopeOfGrant === INTEROP.SelectedFromRegistry) {
      list = grant.hasDataInstance ?? []
    }
    if (grant.scopeOfGrant === INTEROP.AllFromRegistry) {
      const dataRegistration = await this.factory.readable.dataRegistration(
        grant.hasDataRegistration
      )
      list = dataRegistration.contains
    }
    for (const resource of list) {
      this.parentMap.set(resource, {
        id: resource,
        scope: scope,
        resourceServer,
      })
    }
    return new Set(list)
  }

  public childInfo(childId: string, scope: string, parentId: string): ChildInfo {
    const parentInfo = this.parentMap.get(parentId)
    return {
      id: childId,
      scope,
      resourceServer: parentInfo.resourceServer,
      parent: parentInfo.id,
    }
  }

  public setChildInfo(childId: string, scope: string, parentId: string): void {
    this.childMap.set(childId, this.childInfo(childId, scope, parentId))
  }

  private getInfo(id: string): ParentInfo | ChildInfo {
    return (this.parentMap.get(id) || this.childMap.get(id))!
  }

  public async canCreate(resourceServer: string, scope: string): Promise<boolean> {
    const grant = await this.findGrant(resourceServer, scope)
    return grant?.accessMode.includes(ACL.Create)
  }

  public async canCreateChild(parentId: string, scope: string): Promise<boolean> {
    const { resourceServer } = this.parentMap.get(parentId)
    const grant = await this.findGrant(resourceServer, scope)
    return grant?.accessMode.includes(ACL.Create)
  }

  public async canUpdate(id: string): Promise<boolean> {
    const info = this.getInfo(id)
    const grant = await this.findGrant(info.resourceServer, info.scope)
    return grant?.accessMode.includes(ACL.Update)
  }

  public async canDelete(id: string): Promise<boolean> {
    const info = this.getInfo(id)
    const grant = await this.findGrant(info.resourceServer, info.scope)
    return grant?.accessMode.includes(ACL.Delete)
  }

  // TODO: rename to idForNew
  public async iriForNew(resourceServer: string, scope: string): Promise<string> {
    const grant = await this.findGrant(resourceServer, scope)
    if (!grant) throw new Error('No grant found')
    return Grant.iriForNew(grant, this.factory.randomUUID)
  }

  public async iriForChild(parentId: string, scope: string): Promise<string> {
    const { resourceServer } = this.parentMap.get(parentId)
    const iri = await this.iriForNew(resourceServer, scope)
    this.childMap.set(iri, this.childInfo(iri, scope, parentId))
    return iri
  }

  public findParent(childId: string): string {
    return this.childMap.get(childId).parent
  }

  public async discoverDescription(resourceIri: string): Promise<string | undefined> {
    return discoverDescriptionResource(resourceIri, this.fetch)
  }
}
