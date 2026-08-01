import {
  type AuthorizationAgentFactory,
  type CRUDAuthorizationRegistry,
  DataAuthorization,
  type DataAuthorizationData,
  type FinalDataAuthorizationData,
  addDataAuthorization,
  removeDataAuthorization,
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
 * Replace the registry links for a grantee with the given data authorization IRIs.
 * Removes the grantee's previously linked data authorizations and adds the new ones.
 */
export async function replaceDataAuthorizationsForGrantee(
  registry: CRUDAuthorizationRegistry,
  grantee: string,
  dataAuthorizationIris: string[]
): Promise<void> {
  const existing = await registry.findDataAuthorizations(grantee)
  for (const dataAuthorization of existing) {
    await removeDataAuthorization(registry, dataAuthorization.id!)
  }
  for (const iri of dataAuthorizationIris) {
    await addDataAuthorization(registry, iri)
  }
}

/**
 * Create (and store) data authorizations for an authorization structure and link
 * them from the authorization registry.
 *
 * - granted: builds and stores FinalDataAuthorizationData POJOs (with reuse of
 *   existing data authorizations when extendIfExists), returns the stored list.
 * - denied: clears the grantee's existing data authorizations, returns [].
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

    // link reused and newly created data authorizations from the registry
    await replaceDataAuthorizationsForGrantee(authorizationRegistry, authorization.grantee, [
      ...dataAuthorizationsToReuse,
      ...dataAuthorizations.map((da) => da.id),
    ])
  } else {
    // denied authorization: clear the grantee's existing data authorizations
    for (const dataAuthorization of existingDataAuthorizations) {
      await removeDataAuthorization(authorizationRegistry, dataAuthorization.id!)
    }
  }

  return dataAuthorizations
}
