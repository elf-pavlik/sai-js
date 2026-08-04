import {
  type AuthorizationAgentFactory,
  type CRUDAuthorizationRegistry,
  DataAuthorization,
  type DataAuthorizationData,
  type FinalDataAuthorizationData,
} from '@janeirodigital/interop-data-model'
import { INTEROP } from '@janeirodigital/interop-utils'

// Nesting is being used to capture inheritance before IRIs are available
export type NestedDataAuthorizationData = DataAuthorizationData & {
  children?: DataAuthorizationData[]
}

interface BaseAuthorization {
  grantee: string
  hasAccessNeedGroup?: string
}

export interface GrantedAuthorization extends BaseAuthorization {
  dataAuthorizations: DataAuthorizationData[]
  granted: true
}

export interface DeniedAuthorization extends BaseAuthorization {
  dataAuthorizations?: never
  granted: false
}

export type AccessAuthorizationStructure = GrantedAuthorization | DeniedAuthorization

/**
 * Build FinalDataAuthorizationData POJOs, assigning IRIs from the authorization
 * registry and wiring children via hasInheritingAuthorization.
 */
export async function generateDataAuthorizations(
  dataAuthorizations: NestedDataAuthorizationData[],
  grantedBy: string,
  authorizationRegistry: CRUDAuthorizationRegistry
): Promise<FinalDataAuthorizationData[]> {
  // don't create data authorization where grantee == dataowner
  const validDataAuthorizations = dataAuthorizations.filter(
    (dataAuthorization) => dataAuthorization.dataOwner !== dataAuthorization.grantee
  )

  const result: FinalDataAuthorizationData[] = []
  for (const dataAuthorization of validDataAuthorizations) {
    const dataAuthorizationIri = authorizationRegistry.iriForContained()
    const children: FinalDataAuthorizationData[] = []
    if (dataAuthorization.children) {
      for (const childDataAuthorization of dataAuthorization.children) {
        const childDataAuthorizationIri = authorizationRegistry.iriForContained()
        children.push({
          ...childDataAuthorization,
          id: childDataAuthorizationIri,
          inheritsFromAuthorization: dataAuthorizationIri,
          grantedBy,
        })
      }
    }
    result.push(
      {
        ...dataAuthorization,
        id: dataAuthorizationIri,
        hasInheritingAuthorization: children.map((child) => child.id),
        grantedBy,
      },
      ...children
    )
  }
  return result
}

/**
 * Delete the grantee's data authorization resources (parents and their
 * hasInheritingAuthorization children) whose IRI is not in irisToKeep.
 * Containment is server-managed (ldp:contains), so kept authorizations stay
 * linked to the registry without any client-side link management.
 */
export async function replaceDataAuthorizationsForGrantee(
  registry: CRUDAuthorizationRegistry,
  existingDataAuthorizations: DataAuthorizationData[],
  irisToKeep: string[],
  factory: AuthorizationAgentFactory
): Promise<void> {
  const keep = new Set(irisToKeep)
  // children of kept parents must stay too (the kept parent still references them)
  for (const dataAuthorization of existingDataAuthorizations) {
    if (keep.has(dataAuthorization.id!)) {
      for (const child of dataAuthorization.hasInheritingAuthorization ?? []) keep.add(child)
    }
  }
  const irisToDelete = new Set(
    existingDataAuthorizations.flatMap((da) => [da.id!, ...(da.hasInheritingAuthorization ?? [])])
  ).difference(keep)
  // Change back to Promise.all after the CSS bug is fixed.
  for (const iri of irisToDelete) {
    const response = await factory.fetch(iri, { method: 'DELETE' })
    if (!response.ok) {
      throw new Error(`failed to delete data authorization: ${response.status}`)
    }
  }
  await registry.fetchData()
}

/**
 * Create (and store) data authorizations for an authorization structure. The
 * registry's containment (ldp:contains) is server-managed: storing a data
 * authorization via PUT adds it to the registry, and deleting the resource
 * removes it.
 *
 * - granted: builds and stores FinalDataAuthorizationData POJOs (with reuse of
 *   existing data authorizations when extendIfExists), deletes existing data
 *   authorization resources which are not reused, returns the stored list.
 * - denied: deletes all of the grantee's existing data authorization resources,
 *   returns [].
 */
export async function generateAuthorization(
  authorization: AccessAuthorizationStructure,
  grantedBy: string,
  authorizationRegistry: CRUDAuthorizationRegistry,
  factory: AuthorizationAgentFactory,
  extendIfExists: boolean
): Promise<FinalDataAuthorizationData[]> {
  if (extendIfExists && !authorization.granted) {
    throw new Error('Previous denied authorizations can not be extended')
  }

  const existingDataAuthorizations = await authorizationRegistry.findDataAuthorizations(
    authorization.grantee
  )

  // TODO: agent has and access authorization, with data authorization (SelectedFromRegistry) which does not include this data instance
  // do we need to check access modes? (if same extend data authorization, if different create a new one)
  const dataAuthorizationsToReuse: string[] = []
  if (extendIfExists && authorization.granted) {
    // start with reusing all existing data authorizations
    dataAuthorizationsToReuse.push(...existingDataAuthorizations.map((da) => da.id!))

    // TODO: case when new doesn't have inheriting but matching had inheriting data grant, create additional data authorization instead of replacing
    // check if some of existing data authorizations overlap for a registry
    for (const existingDataAuthorization of existingDataAuthorizations) {
      const matchingDataAuthorization = authorization.dataAuthorizations.find(
        (da) => existingDataAuthorization.hasDataRegistration === da.hasDataRegistration
      )
      if (matchingDataAuthorization) {
        // TODO: should we handle it differently
        if (matchingDataAuthorization.scopeOfAuthorization !== INTEROP.SelectedFromRegistry.value)
          throw new Error(`unexpected scope: ${matchingDataAuthorization.scopeOfAuthorization}`)

        // copy over selected instances from existing data authorization
        // TODO: check for duplicates (make it a set?)
        matchingDataAuthorization.hasDataInstance = [
          ...(matchingDataAuthorization.hasDataInstance ?? []),
          ...(existingDataAuthorization.hasDataInstance ?? []),
        ]

        // exclude from data authorization to reuse
        const irisToExclude = [
          existingDataAuthorization.id!,
          ...(existingDataAuthorization.hasInheritingAuthorization ?? []),
        ]
        for (const iri of irisToExclude) {
          const index = dataAuthorizationsToReuse.indexOf(iri)
          if (index !== -1) dataAuthorizationsToReuse.splice(index, 1)
        }
      }
    }
  }

  let dataAuthorizations: FinalDataAuthorizationData[] = []
  if (authorization.granted) {
    dataAuthorizations = await generateDataAuthorizations(
      authorization.dataAuthorizations,
      grantedBy,
      authorizationRegistry
    )

    // store data authorizations
    for (const dataAuthorization of dataAuthorizations) {
      const store = await DataAuthorization.toDataset(dataAuthorization)
      const response = await factory.fetch(dataAuthorization.id, {
        method: 'PUT',
        dataset: store,
        headers: {
          'If-None-Match': '*',
        },
      })
      if (!response.ok) {
        throw new Error(`failed to store data authorization: ${response.status}`)
      }
    }

    // delete the grantee's existing data authorization resources which are not reused
    await replaceDataAuthorizationsForGrantee(
      authorizationRegistry,
      existingDataAuthorizations,
      dataAuthorizationsToReuse,
      factory
    )
  } else {
    // denied authorization: delete all of the grantee's existing data authorization resources
    await replaceDataAuthorizationsForGrantee(
      authorizationRegistry,
      existingDataAuthorizations,
      [],
      factory
    )
  }

  return dataAuthorizations
}
