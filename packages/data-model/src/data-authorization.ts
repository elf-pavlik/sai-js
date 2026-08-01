import { INTEROP, asyncIterableToArray } from '@janeirodigital/interop-utils'
import type { DatasetCore } from '@rdfjs/types'
import { Store } from 'n3'
import type { AuthorizationAgentFactory, CRUDRegistrySet } from '.'
import { getDataGrantIris, getDataGrants } from './crud/agent-registration'
import dataAuthorizationContext from './data-authorization-context'
import type { GeneratedGrants, GrantData, FinalGrantData } from './grant'
import { frameDataset, frameDoc, toStore, withContext } from './jsonld-utils'
import type { ReadableDataRegistration } from './readable/data-registration'

// ──────────────────────────
// Types
// ──────────────────────────

/** Plain JSON representation of a Data Authorization. */
export type DataAuthorizationData = {
  /** IRI of the data authorization resource; absent until assigned by the registry */
  id?: string

  // String properties (single-value named nodes)
  grantee: string
  grantedBy: string
  registeredShapeTree: string
  scopeOfAuthorization: string
  dataOwner?: string
  hasDataRegistration?: string
  satisfiesAccessNeed?: string
  inheritsFromAuthorization?: string // parent data authorization IRI (Inherited scope)

  // Array properties (multi-value named nodes)
  accessMode: string[]
  creatorAccessMode?: string[]
  hasDataInstance?: string[]

  // Children discovered via inverse quads in the dataset (lazily resolved)
  hasInheritingAuthorization?: string[] // child data authorization IRIs
}

/** A data authorization that has been assigned its IRI. */
export type FinalDataAuthorizationData = DataAuthorizationData &
  Required<Pick<DataAuthorizationData, 'id'>>

export interface SourceAndDelegatedGrants {
  source: FinalGrantData[]
  delegated: GrantData[]
}

// ──────────────────────────
// Read path: Dataset / JSON-LD → DataAuthorizationData
// ──────────────────────────

/**
 * Convert a parsed RDF dataset into a DataAuthorizationData POJO.
 *
 * Uses jsonld.frame with the data authorization context to resolve @reverse
 * relationships (hasInheritingAuthorization) automatically, without
 * embedding child nodes.
 */
export async function fromDataset(
  dataset: DatasetCore,
  iri: string
): Promise<DataAuthorizationData> {
  return compactNodeToDataAuthorizationData(
    (await frameDataset(dataset, dataAuthorizationContext, iri)) as any
  )
}

/**
 * Convert a JSON-LD document (fetched as application/ld+json) directly into a
 * DataAuthorizationData POJO.
 *
 * The document can be in expanded, compacted, or flattened form.
 * Uses jsonld.frame to resolve @reverse relationships
 * (hasInheritingAuthorization) automatically, without embedding child nodes.
 */
export async function fromJsonLd(doc: unknown, iri: string): Promise<DataAuthorizationData> {
  return compactNodeToDataAuthorizationData(
    (await frameDoc(doc, dataAuthorizationContext, iri)) as any
  )
}

/**
 * Extract the data authorization node from a framed JSON-LD output into a
 * DataAuthorizationData POJO.
 *
 * The framed output uses compacted form with @type: @id on all properties,
 * so values are plain IRI strings (or null/undefined when absent).
 */
function compactNodeToDataAuthorizationData(node: any): DataAuthorizationData {
  return {
    id: node.id ?? node['@id'],
    grantee: node.grantee,
    grantedBy: node.grantedBy,
    registeredShapeTree: node.registeredShapeTree,
    scopeOfAuthorization: node.scopeOfAuthorization,
    dataOwner: node.dataOwner ?? undefined,
    hasDataRegistration: node.hasDataRegistration ?? undefined,
    satisfiesAccessNeed: node.satisfiesAccessNeed ?? undefined,
    inheritsFromAuthorization: node.inheritsFromAuthorization ?? undefined,
    accessMode: node.accessMode ?? [],
    creatorAccessMode: node.creatorAccessMode ?? [],
    hasDataInstance: node.hasDataInstance ?? [],
    hasInheritingAuthorization: node.hasInheritingAuthorization ?? [],
  }
}

// ──────────────────────────
// Write path: DataAuthorizationData → Dataset / JSON-LD
// ──────────────────────────

/**
 * Convert a FinalDataAuthorizationData to an N3 Store (DatasetCore).
 *
 * The resulting dataset can be passed directly to an RdfFetch call
 * as the `dataset` option (the wrapper serializes it to turtle).
 */
export async function toDataset(data: FinalDataAuthorizationData): Promise<Store> {
  return toStore(toJsonLd(data), data.id)
}

/**
 * Build a JSON-LD document (with embedded context) ready for PUT as application/ld+json.
 *
 * The document uses the data authorization context so that `@reverse`
 * relationships (hasInheritingAuthorization) produce the correct RDF quads
 * on the server side.
 */
export function toJsonLd(data: FinalDataAuthorizationData): Record<string, unknown> {
  return withContext(dataAuthorizationContext, data)
}

// ──────────────────────────
// Behavior functions (replacing class methods)
// ──────────────────────────

/**
 * Fetch the data authorizations that inherit from this one (children linked
 * via interop:inheritsFromAuthorization).
 */
export async function inheritingAuthorizations(
  data: DataAuthorizationData,
  factory: AuthorizationAgentFactory
): Promise<DataAuthorizationData[]> {
  const childIris = data.hasInheritingAuthorization ?? []
  return Promise.all(childIris.map((iri) => factory.readable.dataAuthorization(iri)))
}

async function generateChildDelegatedGrantData(
  data: DataAuthorizationData,
  parentGrantIri: string,
  sourceGrant: GrantData,
  registrySet: CRUDRegistrySet,
  grantee: string
): Promise<GrantData[]> {
  const result: GrantData[] = []
  const childAuthorizations = await inheritingAuthorizations(data, registrySet.factory)
  for (const childAuthorization of childAuthorizations) {
    // Find matching child grant by fetching each child IRI
    let childSourceGrant: GrantData | undefined
    for (const childIri of sourceGrant.hasInheritingGrant ?? []) {
      const childGrant = await registrySet.factory.readable.dataGrant(childIri)
      if (childGrant.registeredShapeTree === childAuthorization.registeredShapeTree) {
        childSourceGrant = childGrant
        break
      }
    }
    if (!childSourceGrant) continue

    const childData: GrantData = {
      // no id — delegation endpoint assigns IRIs
      grantee,
      grantedBy: data.grantedBy,
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

async function generateDelegatedDataGrants(
  data: DataAuthorizationData,
  registrySet: CRUDRegistrySet,
  grantee: string,
  dataOwner?: string
): Promise<GrantData[]> {
  if (data.scopeOfAuthorization === INTEROP.Inherited.value) {
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
      (grant) => grant.registeredShapeTree === data.registeredShapeTree
    )
    if (data.hasDataRegistration) {
      matchingDataGrants = matchingDataGrants.filter(
        (grant) => grant.hasDataRegistration === data.hasDataRegistration
      )
    }

    for (const sourceGrant of matchingDataGrants) {
      const regularGrantIri = registrySet.hasGrantRegistry.iriForContained()

      const childGrantData: GrantData[] = await generateChildDelegatedGrantData(
        data,
        regularGrantIri,
        sourceGrant,
        registrySet,
        grantee
      )
      const scope: string =
        data.scopeOfAuthorization === INTEROP.SelectedFromRegistry.value ||
        sourceGrant.scopeOfGrant === INTEROP.SelectedFromRegistry.value
          ? INTEROP.SelectedFromRegistry.value
          : INTEROP.AllFromRegistry.value
      const grant: GrantData = {
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
      if (grant.scopeOfGrant === INTEROP.SelectedFromRegistry.value) {
        if (data.hasDataInstance && data.hasDataInstance.length) {
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
  dataRegistrations: ReadableDataRegistration[],
  registrySet: CRUDRegistrySet,
  grantee: string,
  storageIri: string
): Promise<FinalGrantData[]> {
  const result: FinalGrantData[] = []
  const childAuthorizations = await inheritingAuthorizations(data, registrySet.factory)
  for (const childAuthorization of childAuthorizations) {
    const childGrantIri = registrySet.hasGrantRegistry.iriForContained()
    const dataRegistration = dataRegistrations.find(
      (registration) =>
        registration.registeredShapeTree === childAuthorization.registeredShapeTree
    )
    if (!dataRegistration) continue

    const childData: FinalGrantData = {
      id: childGrantIri,
      grantee,
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

async function generateSourceDataGrants(
  data: DataAuthorizationData,
  registrySet: CRUDRegistrySet,
  grantee: string
): Promise<FinalGrantData[]> {
  if (data.scopeOfAuthorization === INTEROP.Inherited.value) {
    throw new Error(
      'this method should not be callend on data authorizations with Inherited scope'
    )
  }

  const result: FinalGrantData[] = []

  for (const dataRegistry of registrySet.hasDataRegistry) {
    // FIXME handle each data registry independently

    const dataRegistrations = await asyncIterableToArray(dataRegistry.registrations)

    let matchingRegistration: ReadableDataRegistration

    if (data.hasDataRegistration) {
      // match registration if specified
      matchingRegistration = dataRegistrations.find(
        (registration) => registration.iri === data.hasDataRegistration
      )
    } else {
      // match shape tree
      matchingRegistration = dataRegistrations.find(
        (registration) => registration.registeredShapeTree === data.registeredShapeTree
      )
    }

    if (!matchingRegistration) continue

    // create source grant
    const regularGrantIri = registrySet.hasGrantRegistry.iriForContained()

    // create children if needed
    const childGrantData: FinalGrantData[] = await generateChildSourceGrantData(
      data,
      regularGrantIri,
      dataRegistrations,
      registrySet,
      grantee,
      await dataRegistry.storageIri()
    )

    let scopeOfGrant = INTEROP.AllFromRegistry.value
    if (data.scopeOfAuthorization === INTEROP.SelectedFromRegistry.value)
      scopeOfGrant = INTEROP.SelectedFromRegistry.value
    const grant: FinalGrantData = {
      id: regularGrantIri,
      grantee,
      grantedBy: data.grantedBy,
      dataOwner: data.grantedBy,
      registeredShapeTree: data.registeredShapeTree,
      hasDataRegistration: matchingRegistration.iri,
      hasStorage: await dataRegistry.storageIri(),
      scopeOfGrant,
      accessMode: data.accessMode,
    }
    if (data.hasDataInstance && data.hasDataInstance.length) {
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
  registrySet: CRUDRegistrySet,
  grantee: string
): Promise<SourceAndDelegatedGrants> {
  const dataGrantData: SourceAndDelegatedGrants = {
    source: [],
    delegated: [],
  }

  if (data.dataOwner && data.scopeOfAuthorization === INTEROP.AllFromRole.value) {
    const role = await registrySet.factory.crud.role(data.dataOwner)
    for (const member of role.members) {
      if (member === data.grantedBy) {
        const sourceGrants = await generateSourceDataGrants(data, registrySet, grantee)
        dataGrantData.source.push(...sourceGrants)
      } else {
        const delegatedGrants = await generateDelegatedDataGrants(
          data,
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
  if (!data.dataOwner || data.dataOwner === data.grantedBy) {
    dataGrantData.source = await generateSourceDataGrants(data, registrySet, grantee)
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
  registrySet: CRUDRegistrySet,
  grantee: string
): Promise<GeneratedGrants> {
  const sourceGrants: FinalGrantData[] = []
  const delegatedGrants: GrantData[] = []

  for (const dataAuthorization of dataAuthorizations) {
    if (dataAuthorization.scopeOfAuthorization === INTEROP.Inherited.value) {
      continue
    }
    const grants = await generateDataGrants(dataAuthorization, registrySet, grantee)
    sourceGrants.push(...grants.source)
    delegatedGrants.push(...grants.delegated)
  }

  return {
    sourceGrants,
    delegatedGrants,
  }
}

export type { GeneratedGrants } from './grant'
