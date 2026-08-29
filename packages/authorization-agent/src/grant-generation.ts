import {
  type DataAuthorizationData,
  type DataModelDependencies,
  type DataRegistrationData,
  DataRegistry,
  type FinalGrantData,
  type GeneratedGrants,
  type GrantData,
  GrantRegistry,
  type RegistrySetData,
  childIris,
  frameDataInstance,
  loadShapeTree,
} from '@janeirodigital/interop-data-model'
import { INTEROP, type WhatwgFetch } from '@janeirodigital/interop-utils'
import {
  type SparqlTransport,
  getDataAuthorization,
  getDataGrant,
  getDataRegistration,
  getRole,
  getSocialAgentRegistration,
  listContained,
  listDataRegistrations,
} from './sparql'

// ──────────────────────────
// Instance enumeration over the registry plane (resolves the Phase-2
// wrinkle: components' `Grant.getDataInstanceIterator` usage)
// ──────────────────────────

/**
 * Iterate the data instance ids described by a grant, over the registry
 * plane — AllFromRegistry via the data registration's `contains`,
 * SelectedFromRegistry via `hasDataInstance`, Inherited via the parent chain
 * plus data-plane child walks. The Inherited arm still derefs instance
 * documents (data-instance framing) with the session's `fetch`.
 */
export async function* dataInstanceIrisForGrant(
  grant: GrantData,
  transport: SparqlTransport,
  fetch: WhatwgFetch
): AsyncIterable<string> {
  switch (grant.scopeOfGrant) {
    case INTEROP.AllFromRegistry: {
      const registration = await getDataRegistration(transport, grant.hasDataRegistration)
      for (const id of registration.contains) {
        yield id
      }
      break
    }
    case INTEROP.SelectedFromRegistry: {
      for (const id of grant.hasDataInstance ?? []) {
        yield id
      }
      break
    }
    case INTEROP.Inherited: {
      const parentGrant = await getDataGrant(transport, grant.inheritsFromGrant!)
      for await (const parentId of dataInstanceIrisForGrant(parentGrant, transport, fetch)) {
        yield* await getChildInstanceIris(parentGrant, parentId, grant.registeredShapeTree, fetch)
      }
      break
    }
    default:
      throw new Error(`Unknown scope: ${grant.scopeOfGrant}`)
  }
}

/**
 * Child instance ids referenced by a parent instance for a shape tree, via
 * the parent shape tree's reference predicate (data-plane read).
 */
async function getChildInstanceIris(
  parentGrant: GrantData,
  parentId: string,
  childShapeTree: string,
  fetch: WhatwgFetch
): Promise<string[]> {
  const parentShapeTree = await loadShapeTree(parentGrant.registeredShapeTree, fetch)
  const node = await frameDataInstance(parentId, fetch, parentShapeTree)
  return childIris(node, parentShapeTree, childShapeTree)
}

// ──────────────────────────
// Grant-generation chain (relocated from data-model; listings on the AA's
// registry plane — docs/sparql.md)
// ──────────────────────────

export interface SourceAndDelegatedGrants {
  source: FinalGrantData[]
  delegated: GrantData[]
}

/**
 * Fetch the data authorizations that inherit from this one (children linked
 * via interop:inheritsFromAuthorization) — via the registry plane.
 */
async function inheritingAuthorizations(
  data: DataAuthorizationData,
  transport: SparqlTransport
): Promise<DataAuthorizationData[]> {
  const childIris = data.hasInheritingAuthorization ?? []
  return Promise.all(childIris.map((iri) => getDataAuthorization(transport, iri)))
}

async function generateChildDelegatedGrantData(
  data: DataAuthorizationData,
  parentGrantIri: string,
  sourceGrant: GrantData,
  registrySet: RegistrySetData,
  grantee: string,
  deps: DataModelDependencies,
  transport: SparqlTransport
): Promise<GrantData[]> {
  const result: GrantData[] = []
  const childAuthorizations = await inheritingAuthorizations(data, transport)
  for (const childAuthorization of childAuthorizations) {
    // Find matching child grant by reading each child IRI (registry plane)
    let childSourceGrant: GrantData | undefined
    for (const childIri of sourceGrant.hasInheritingGrant ?? []) {
      const childGrant = await getDataGrant(transport, childIri)
      if (childGrant.registeredShapeTree === childAuthorization.registeredShapeTree) {
        childSourceGrant = childGrant
        break
      }
    }
    if (!childSourceGrant) continue

    const childData: GrantData = {
      // no id — delegation endpoint assigns IRIs
      type: [INTEROP.DataGrant],
      grantee,
      grantedBy: data.grantedBy,
      dataOwner: childSourceGrant.dataOwner,
      registeredShapeTree: childAuthorization.registeredShapeTree,
      hasDataRegistration: childSourceGrant.hasDataRegistration,
      hasStorage: childSourceGrant.hasStorage,
      scopeOfGrant: INTEROP.Inherited,
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

async function generateDelegatedDataGrants(
  data: DataAuthorizationData,
  registrySet: RegistrySetData,
  grantee: string,
  deps: DataModelDependencies,
  transport: SparqlTransport,
  dataOwner?: string
): Promise<GrantData[]> {
  if (data.scopeOfAuthorization === INTEROP.Inherited) {
    throw new Error('this method should not be callend on data authorizations with Inherited scope')
  }
  const result: GrantData[] = []

  // the `hasSocialAgentRegistration` listing + bodies via the registry plane
  // (replaces the HTTP `AgentRegistry.socialAgentRegistrations` sweep)
  const agentRegistrationIris = await listContained(transport, registrySet.hasAgentRegistry.id)
  const agentRegistrations = await Promise.all(
    agentRegistrationIris.map((iri) => getSocialAgentRegistration(transport, iri))
  )

  for (const agentRegistration of agentRegistrations) {
    // data onwer is specified but it is not their registration
    if (dataOwner && dataOwner !== agentRegistration.registeredAgent) {
      continue
    }
    // don't create delegated data grants for data owned by the grantee (registeredAgent)
    if (grantee === agentRegistration.registeredAgent) {
      continue
    }
    // only inspect registrations that have a reciprocal registration
    if (!agentRegistration.reciprocalRegistration) continue
    const reciprocalReg = await getSocialAgentRegistration(
      transport,
      agentRegistration.reciprocalRegistration
    )

    if (reciprocalReg.hasDataGrant.length === 0) continue

    const reciprocalDataGrants = await Promise.all(
      reciprocalReg.hasDataGrant.map((grantIri) => getDataGrant(transport, grantIri))
    )

    let matchingDataGrants = reciprocalDataGrants.filter(
      (grant) => grant.registeredShapeTree === data.registeredShapeTree
    )
    if (data.hasDataRegistration) {
      matchingDataGrants = matchingDataGrants.filter(
        (grant) => grant.hasDataRegistration === data.hasDataRegistration
      )
    }

    for (const sourceGrant of matchingDataGrants) {
      const regularGrantIri = GrantRegistry.iriForContained(
        registrySet.hasGrantRegistry,
        deps.randomUUID
      )

      const childGrantData: GrantData[] = await generateChildDelegatedGrantData(
        data,
        regularGrantIri,
        sourceGrant,
        registrySet,
        grantee,
        deps,
        transport
      )
      const scope: string =
        data.scopeOfAuthorization === INTEROP.SelectedFromRegistry ||
        sourceGrant.scopeOfGrant === INTEROP.SelectedFromRegistry
          ? INTEROP.SelectedFromRegistry
          : INTEROP.AllFromRegistry
      const grant: GrantData = {
        type: [INTEROP.DataGrant],
        grantee,
        grantedBy: data.grantedBy,
        dataOwner: sourceGrant.dataOwner,
        registeredShapeTree: sourceGrant.registeredShapeTree,
        hasDataRegistration: sourceGrant.hasDataRegistration,
        hasStorage: sourceGrant.hasStorage,
        scopeOfGrant: scope,
        delegationOfGrant: sourceGrant.id!,
        accessMode: data.accessMode.filter((mode) => sourceGrant.accessMode.includes(mode)),
      }
      if (grant.scopeOfGrant === INTEROP.SelectedFromRegistry) {
        if (data.hasDataInstance?.length) {
          grant.hasDataInstance = [...data.hasDataInstance]
        } else {
          grant.hasDataInstance = [...(sourceGrant.hasDataInstance ?? [])]
        }
      }
      if (childGrantData.length) {
        // embed full child grant data for delegation endpoint to assign IRIs
        grant.hasInheritingGrant = childGrantData as unknown as string[]
      }
      // only push parent — children are embedded in hasInheritingGrant and handled by GrantIssuanceHandler
      result.push(grant)
    }
  }
  return result
}

async function generateChildSourceGrantData(
  data: DataAuthorizationData,
  parentGrantIri: string,
  dataRegistrations: DataRegistrationData[],
  registrySet: RegistrySetData,
  grantee: string,
  storageIri: string,
  deps: DataModelDependencies,
  transport: SparqlTransport
): Promise<FinalGrantData[]> {
  const result: FinalGrantData[] = []
  const childAuthorizations = await inheritingAuthorizations(data, transport)
  for (const childAuthorization of childAuthorizations) {
    const childGrantIri = GrantRegistry.iriForContained(
      registrySet.hasGrantRegistry,
      deps.randomUUID
    )
    const dataRegistration = dataRegistrations.find(
      (registration) => registration.registeredShapeTree === childAuthorization.registeredShapeTree
    )
    if (!dataRegistration) continue

    const childData: FinalGrantData = {
      id: childGrantIri,
      type: [INTEROP.DataGrant],
      grantee,
      grantedBy: childAuthorization.grantedBy,
      dataOwner: childAuthorization.grantedBy,
      registeredShapeTree: childAuthorization.registeredShapeTree,
      hasDataRegistration: dataRegistration.id,
      hasStorage: storageIri,
      scopeOfGrant: INTEROP.Inherited,
      accessMode: childAuthorization.accessMode,
      inheritsFromGrant: parentGrantIri,
    }
    result.push(childData)
  }
  return result
}

async function generateSourceDataGrants(
  data: DataAuthorizationData,
  registrySet: RegistrySetData,
  grantee: string,
  deps: DataModelDependencies,
  transport: SparqlTransport
): Promise<FinalGrantData[]> {
  if (data.scopeOfAuthorization === INTEROP.Inherited) {
    throw new Error('this method should not be callend on data authorizations with Inherited scope')
  }

  const result: FinalGrantData[] = []

  for (const dataRegistry of registrySet.hasDataRegistry) {
    // FIXME handle each data registry independently

    // the `hasDataRegistration` listing + bodies via the registry plane
    // (replaces the HTTP `DataRegistry.registrations` iterator)
    const registrationIris = await listDataRegistrations(transport, dataRegistry.id)
    const dataRegistrations = await Promise.all(
      registrationIris.map((iri) => getDataRegistration(transport, iri))
    )

    let matchingRegistration: DataRegistrationData

    if (data.hasDataRegistration) {
      // match registration if specified
      matchingRegistration = dataRegistrations.find(
        (registration) => registration.id === data.hasDataRegistration
      )
    } else {
      // match shape tree
      matchingRegistration = dataRegistrations.find(
        (registration) => registration.registeredShapeTree === data.registeredShapeTree
      )
    }

    if (!matchingRegistration) continue

    // create source grant
    const regularGrantIri = GrantRegistry.iriForContained(
      registrySet.hasGrantRegistry,
      deps.randomUUID
    )

    // create children if needed
    const childGrantData: FinalGrantData[] = await generateChildSourceGrantData(
      data,
      regularGrantIri,
      dataRegistrations,
      registrySet,
      grantee,
      await DataRegistry.storageIri(dataRegistry, deps.fetch),
      deps,
      transport
    )

    let scopeOfGrant: string = INTEROP.AllFromRegistry
    if (data.scopeOfAuthorization === INTEROP.SelectedFromRegistry)
      scopeOfGrant = INTEROP.SelectedFromRegistry
    const grant: FinalGrantData = {
      id: regularGrantIri,
      type: [INTEROP.DataGrant],
      grantee,
      grantedBy: data.grantedBy,
      dataOwner: data.grantedBy,
      registeredShapeTree: data.registeredShapeTree,
      hasDataRegistration: matchingRegistration.id,
      hasStorage: await DataRegistry.storageIri(dataRegistry, deps.fetch),
      scopeOfGrant,
      accessMode: data.accessMode,
    }
    if (data.hasDataInstance?.length) {
      grant.hasDataInstance = data.hasDataInstance
    }
    if (childGrantData.length) {
      grant.hasInheritingGrant = childGrantData.map((g) => g.id).filter(Boolean)
    }
    result.push(grant, ...childGrantData)
  }

  if (!result.length) throw new Error('no data grants were generated!')
  return result
}

/**
 * Generate source and/or delegated data grants for a single data authorization.
 *
 * Source grants are only created if the data authorization is registered by the
 * data owner; otherwise only delegated data grants are created. Handles the
 * AllFromRole scope by iterating over role members.
 */
export async function generateDataGrants(
  data: DataAuthorizationData,
  registrySet: RegistrySetData,
  grantee: string,
  deps: DataModelDependencies,
  transport: SparqlTransport
): Promise<SourceAndDelegatedGrants> {
  const dataGrantData: SourceAndDelegatedGrants = {
    source: [],
    delegated: [],
  }

  if (data.dataOwner && data.scopeOfAuthorization === INTEROP.AllFromRole) {
    const role = await getRole(transport, data.dataOwner)
    if (!role) throw new Error(`role not found: ${data.dataOwner}`)
    for (const member of role.members) {
      if (member === data.grantedBy) {
        const sourceGrants = await generateSourceDataGrants(
          data,
          registrySet,
          grantee,
          deps,
          transport
        )
        dataGrantData.source.push(...sourceGrants)
      } else {
        const delegatedGrants = await generateDelegatedDataGrants(
          data,
          registrySet,
          grantee,
          deps,
          transport,
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
  if (!data.dataOwner || data.dataOwner === data.grantedBy) {
    dataGrantData.source = await generateSourceDataGrants(
      data,
      registrySet,
      grantee,
      deps,
      transport
    )
  }

  // do not create delegated data grants if granted by data owner, source grants will be created instead
  /* Delegated grants are only created for data owned by others than agent granting the authorization
   * This can only happen with scopes:
   * - All - there will be no dataOwner set
   * - All From Agent - dataOwner will be different than grantedBy
   * - lower with same condition as previous
   * Otherwise only source data grants are created
   */
  if (!data.dataOwner || data.dataOwner !== data.grantedBy) {
    dataGrantData.delegated = await generateDelegatedDataGrants(
      data,
      registrySet,
      grantee,
      deps,
      transport,
      data.dataOwner
    )
  }

  return dataGrantData
}

/**
 * Generate source and delegated data grants for a list of data authorizations.
 *
 * Inherited-scope data authorizations are skipped (they are handled by their
 * parent via hasInheritingAuthorization). An empty list means the grantee is
 * not granted and results in empty grants.
 */
export async function generateGrantsForAuthorization(
  dataAuthorizations: DataAuthorizationData[],
  registrySet: RegistrySetData,
  grantee: string,
  deps: DataModelDependencies,
  transport: SparqlTransport
): Promise<GeneratedGrants> {
  const sourceGrants: FinalGrantData[] = []
  const delegatedGrants: GrantData[] = []

  for (const dataAuthorization of dataAuthorizations) {
    if (dataAuthorization.scopeOfAuthorization === INTEROP.Inherited) {
      continue
    }
    const grants = await generateDataGrants(
      dataAuthorization,
      registrySet,
      grantee,
      deps,
      transport
    )
    sourceGrants.push(...grants.source)
    delegatedGrants.push(...grants.delegated)
  }

  return {
    sourceGrants,
    delegatedGrants,
  }
}
