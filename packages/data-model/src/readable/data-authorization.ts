import { INTEROP, asyncIterableToArray } from '@janeirodigital/interop-utils'
import { Memoize } from 'typescript-memoize'
import { ReadableResource } from '.'
import {
  getDataGrants,
  getDataGrantIris,
  type AuthorizationAgentFactory,
  type CRUDRegistrySet,
  type GrantData,
  type FinalGrantData,
  type ReadableDataRegistration,
} from '..'

interface SourceAndDelegatedGrants {
  source: FinalGrantData[]
  delegated: GrantData[]
}

export class ReadableDataAuthorization extends ReadableResource {
  declare factory: AuthorizationAgentFactory

  hasInheritingAuthorization: ReadableDataAuthorization[]

  async inheritingAuthorizations(): Promise<ReadableDataAuthorization[]> {
    const childIris = this.getSubjectsArray(INTEROP.inheritsFromAuthorization).map(
      (subject) => subject.value
    )
    return Promise.all(childIris.map((iri) => this.factory.readable.dataAuthorization(iri)))
  }

  async bootstrap(): Promise<void> {
    await this.fetchData()
    this.hasInheritingAuthorization = await this.inheritingAuthorizations()
  }

  @Memoize()
  get grantee(): string {
    return this.getObject('grantee').value
  }

  @Memoize()
  get registeredShapeTree(): string {
    return this.getObject('registeredShapeTree').value
  }

  @Memoize()
  get scopeOfAuthorization(): string {
    return this.getObject('scopeOfAuthorization').value
  }

  @Memoize()
  get grantedBy(): string {
    return this.getObject('grantedBy').value
  }

  @Memoize()
  get dataOwner(): string | undefined {
    return this.getObject('dataOwner')?.value
  }

  @Memoize()
  get accessMode(): string[] {
    return this.getObjectsArray('accessMode').map((object) => object.value)
  }

  @Memoize()
  get hasDataRegistration(): string | undefined {
    return this.getObject('hasDataRegistration')?.value
  }

  @Memoize()
  get hasDataInstance(): string[] {
    return this.getObjectsArray('hasDataInstance').map((obj) => obj.value)
  }

  public static async build(
    iri: string,
    factory: AuthorizationAgentFactory
  ): Promise<ReadableDataAuthorization> {
    const instance = new ReadableDataAuthorization(iri, factory)
    await instance.bootstrap()
    return instance
  }

  private async generateChildDelegatedGrantData(
    parentGrantIri: string,
    sourceGrant: GrantData,
    registrySet: CRUDRegistrySet,
    grantee: string
  ): Promise<GrantData[]> {
    const result: GrantData[] = []
    for (const childAuthorization of this.hasInheritingAuthorization) {
      const childGrantIri = registrySet.hasGrantRegistry.iriForContained()

      // Find matching child grant by fetching each child IRI
      let childSourceGrant: GrantData | undefined
      for (const childIri of sourceGrant.hasInheritingGrant ?? []) {
        const childGrant = await this.factory.readable.dataGrant(childIri)
        if (childGrant.registeredShapeTree === childAuthorization.registeredShapeTree) {
          childSourceGrant = childGrant
          break
        }
      }
      if (!childSourceGrant) continue

      const childData: GrantData = {
        id: childGrantIri,
        grantee: grantee,
        grantedBy: this.grantedBy,
        dataOwner: childSourceGrant.dataOwner,
        registeredShapeTree: childAuthorization.registeredShapeTree,
        hasDataRegistration: childSourceGrant.hasDataRegistration,
        hasStorage: childSourceGrant.hasStorage,
        scopeOfGrant: INTEROP.Inherited.value,
        accessMode: childAuthorization.accessMode.filter((mode) =>
          childSourceGrant.accessMode.includes(mode)
        ),
        inheritsFromGrant: parentGrantIri,
        delegationOfGrant: childSourceGrant.id!,
      }
      result.push(childData)
    }
    return result
  }

  private async generateDelegatedDataGrants(
    registrySet: CRUDRegistrySet,
    grantee: string,
    dataOwner?: string
  ): Promise<GrantData[]> {
    if (this.scopeOfAuthorization === INTEROP.Inherited.value) {
      throw new Error(
        'this method should not be callend on data authorizations with Inherited scope'
      )
    }
    const result: GrantData[] = []

    for await (const agentRegistration of registrySet.hasAgentRegistry.socialAgentRegistrations) {
      // data onwer is specified but it is not their registration
      if (dataOwner && dataOwner !== agentRegistration.registeredAgent) {
        continue
      }
      // don't create delegated data grants for data owned by the grantee (registeredAgent)
      if (grantee === agentRegistration.registeredAgent) {
        continue
      }
      const reciprocalReg = agentRegistration.reciprocalRegistration

      if (!reciprocalReg || getDataGrantIris(reciprocalReg).length === 0) continue

      const reciprocalDataGrants = await getDataGrants(reciprocalReg)

      let matchingDataGrants = reciprocalDataGrants.filter(
        (grant) => grant.registeredShapeTree === this.registeredShapeTree
      )
      if (this.hasDataRegistration) {
        matchingDataGrants = matchingDataGrants.filter(
          (grant) => grant.hasDataRegistration === this.hasDataRegistration
        )
      }

      for (const sourceGrant of matchingDataGrants) {
        const regularGrantIri = registrySet.hasGrantRegistry.iriForContained()

        const childGrantData: GrantData[] = await this.generateChildDelegatedGrantData(
          regularGrantIri,
          sourceGrant,
          registrySet,
          grantee
        )
        const scope: string =
          this.scopeOfAuthorization === INTEROP.SelectedFromRegistry.value ||
          sourceGrant.scopeOfGrant === INTEROP.SelectedFromRegistry.value
            ? INTEROP.SelectedFromRegistry.value
            : INTEROP.AllFromRegistry.value
        const data: GrantData = {
          grantee: grantee,
          grantedBy: this.grantedBy,
          dataOwner: sourceGrant.dataOwner,
          registeredShapeTree: sourceGrant.registeredShapeTree,
          hasDataRegistration: sourceGrant.hasDataRegistration,
          hasStorage: sourceGrant.hasStorage,
          scopeOfGrant: scope,
          delegationOfGrant: sourceGrant.id!,
          accessMode: this.accessMode.filter((mode) => sourceGrant.accessMode.includes(mode)),
        }
        if (data.scopeOfGrant === INTEROP.SelectedFromRegistry.value) {
          if (this.hasDataInstance.length) {
            data.hasDataInstance = [...this.hasDataInstance]
          } else {
            data.hasDataInstance = [...(sourceGrant.hasDataInstance ?? [])]
          }
        }
        if (childGrantData.length) {
          data.hasInheritingGrant = childGrantData.map((g) => g.id!).filter(Boolean)
        }
        result.push(data, ...childGrantData)
      }
    }
    return result
  }

  private async generateChildSourceGrantData(
    parentGrantIri: string,
    dataRegistrations: ReadableDataRegistration[],
    registrySet: CRUDRegistrySet,
    grantee: string,
    storageIri: string
  ): Promise<FinalGrantData[]> {
    const result: FinalGrantData[] = []
    for (const childAuthorization of this.hasInheritingAuthorization) {
      const childGrantIri = registrySet.hasGrantRegistry.iriForContained()
      const dataRegistration = dataRegistrations.find(
        (registration) =>
          registration.registeredShapeTree === childAuthorization.registeredShapeTree
      )
      if (!dataRegistration) continue

      const childData: FinalGrantData = {
        id: childGrantIri,
        grantee: grantee,
        grantedBy: childAuthorization.grantedBy,
        dataOwner: childAuthorization.grantedBy,
        registeredShapeTree: childAuthorization.registeredShapeTree,
        hasDataRegistration: dataRegistration.iri,
        hasStorage: storageIri,
        scopeOfGrant: INTEROP.Inherited.value,
        accessMode: childAuthorization.accessMode,
        inheritsFromGrant: parentGrantIri,
      }
      result.push(childData)
    }
    return result
  }

  private async generateSourceDataGrants(
    registrySet: CRUDRegistrySet,
    grantee: string
  ): Promise<FinalGrantData[]> {
    if (this.scopeOfAuthorization === INTEROP.Inherited.value) {
      throw new Error(
        'this method should not be callend on data authorizations with Inherited scope'
      )
    }

    const result: FinalGrantData[] = []

    for (const dataRegistry of registrySet.hasDataRegistry) {
      // FIXME handle each data registry independently

      const dataRegistrations = await asyncIterableToArray(dataRegistry.registrations)

      let matchingRegistration: ReadableDataRegistration

      if (this.hasDataRegistration) {
        // match registration if specified
        matchingRegistration = dataRegistrations.find(
          (registration) => registration.iri === this.hasDataRegistration
        )
      } else {
        // match shape tree
        matchingRegistration = dataRegistrations.find(
          (registration) => registration.registeredShapeTree === this.registeredShapeTree
        )
      }

      if (!matchingRegistration) continue

      // create source grant
      const regularGrantIri = registrySet.hasGrantRegistry.iriForContained()

      // create children if needed
      const childGrantData: FinalGrantData[] = await this.generateChildSourceGrantData(
        regularGrantIri,
        dataRegistrations,
        registrySet,
        grantee,
        await dataRegistry.storageIri()
      )

      let scopeOfGrant = INTEROP.AllFromRegistry.value
      if (this.scopeOfAuthorization === INTEROP.SelectedFromRegistry.value)
        scopeOfGrant = INTEROP.SelectedFromRegistry.value
      const data: FinalGrantData = {
        id: regularGrantIri,
        grantee: grantee,
        grantedBy: this.grantedBy,
        dataOwner: this.grantedBy,
        registeredShapeTree: this.registeredShapeTree,
        hasDataRegistration: matchingRegistration.iri,
        hasStorage: await dataRegistry.storageIri(),
        scopeOfGrant,
        accessMode: this.accessMode,
      }
      if (this.hasDataInstance.length) {
        data.hasDataInstance = this.hasDataInstance
      }
      if (childGrantData.length) {
        data.hasInheritingGrant = childGrantData.map((g) => g.id).filter(Boolean)
      }
      result.push(data, ...childGrantData)
    }

    if (!result.length) throw new Error('no data grants were generated!')
    return result
  }

  public async generateDataGrants(
    registrySet: CRUDRegistrySet,
    grantee: string
  ): Promise<SourceAndDelegatedGrants> {
    const dataGrantData: SourceAndDelegatedGrants = {
      source: [],
      delegated: [],
    }

    if (this.dataOwner && this.scopeOfAuthorization === INTEROP.AllFromRole.value) {
      const role = await this.factory.crud.role(this.dataOwner)
      for (const member of role.members) {
        if (member === this.grantedBy) {
          const sourceGrants = await this.generateSourceDataGrants(registrySet, grantee)
          dataGrantData.source.push(...sourceGrants)
        } else {
          const delegatedGrants = await this.generateDelegatedDataGrants(
            registrySet,
            grantee,
            member
          )
          dataGrantData.delegated.push(...delegatedGrants)
        }
      }
      return dataGrantData
    }

    /* Source grants are only created if Data Authorization is registred by the data owner.
     * This can only happen with scope:
     * - All - there will be no dataOwner set
     * - AllFromAgent - dataOwner will equal grantedBy
     * - lower with same condition as previous
     * Otherwise only delegated data grants are created
     */
    if (!this.dataOwner || this.dataOwner === this.grantedBy) {
      dataGrantData.source = await this.generateSourceDataGrants(registrySet, grantee)
    }

    // do not create delegated data grants if granted by data owner, source grants will be created instead
    /* Delegated grants are only created for data owned by others than agent granting the authorization
     * This can only happen with scopes:
     * - All - there will be no dataOwner set
     * - All From Agent - dataOwner will be different than grantedBy
     * - lower with same condition as previous
     * Otherwise only source data grants are created
     */
    if (!this.dataOwner || this.dataOwner !== this.grantedBy) {
      dataGrantData.delegated = await this.generateDelegatedDataGrants(registrySet, grantee, this.dataOwner)
    }

    return dataGrantData
  }
}
