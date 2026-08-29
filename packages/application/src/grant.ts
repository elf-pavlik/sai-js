import {
  type ApplicationRegistrationData,
  type GrantData,
  childIris,
  frameDataInstance,
  loadDataRegistration,
  loadGrant,
  loadShapeTree,
} from '@janeirodigital/interop-data-model'
import { INTEROP, type WhatwgFetch } from '@janeirodigital/interop-utils'

/**
 * Whether the application registration has any data grants.
 */
export function getGranted(data: ApplicationRegistrationData): boolean {
  return data.hasDataGrant.length > 0
}

/**
 * Fetch all data grants of this application registration.
 */
export async function getDataGrants(
  data: ApplicationRegistrationData,
  fetch: WhatwgFetch
): Promise<GrantData[]> {
  return Promise.all(data.hasDataGrant.map((id) => loadGrant(id, fetch)))
}

/**
 * Generate a new id for a data instance within this grant's registration.
 */
export function iriForNew(grant: GrantData, randomUUID: () => string): string {
  return `${grant.hasDataRegistration}${randomUUID()}`
}

/**
 * Iterate over the ids of the data instances described by this grant.
 * Dispatches based on scopeOfGrant.
 *
 * The application's copy of the iterator (the data-model one in
 * `packages/data-model/src/grant.ts` still serves the components
 * services/DataRegistry consumer — TODO in the plan's Phase 4 replaces that
 * use with an AA SPARQL-backed enumeration, after which this copy becomes the
 * single home).
 */
export async function* getDataInstanceIterator(
  grant: GrantData,
  fetch: WhatwgFetch
): AsyncIterable<string> {
  switch (grant.scopeOfGrant) {
    case INTEROP.AllFromRegistry: {
      const registration = await loadDataRegistration(grant.hasDataRegistration, fetch)
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
      const parentGrant = await loadGrant(grant.inheritsFromGrant!, fetch)
      for await (const parentId of getDataInstanceIterator(parentGrant, fetch)) {
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
 * the parent shape tree's reference predicate.
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