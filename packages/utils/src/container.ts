import type { DatasetCore } from '@rdfjs/types'
import { applyPatch, insertPatch } from './sparql-update'
import type { WhatwgFetch } from './whatwg-fetch'

/**
 * Generate an IRI for a resource contained in the given container. `data` is
 * any object carrying the container IRI in its `id` field (typically a
 * registry or container POJO).
 */
export function iriForContained(
  data: { id: string },
  randomUUID: () => string,
  container = false
): string {
  let containedIri = `${data.id}${randomUUID()}`
  if (container) containedIri += '/'
  return containedIri
}

/**
 * Create a container and populate its description resource via a SPARQL patch.
 *
 * Community Solid Server ignores the PUT body when creating containers, so
 * creation is: PUT an empty container, discover its description resource
 * (HEAD + Link header), then PATCH the description resource with the given
 * dataset serialized as `INSERT DATA { ... }`.
 */
export async function createContainer(
  id: string,
  fetch: WhatwgFetch,
  dataset: DatasetCore
): Promise<void> {
  // create empty container, CSS ignores body!
  const response = await fetch(id, { method: 'PUT' })
  if (!response.ok) {
    console.error(response)
    throw new Error('failed to create empty container')
  }

  await applyPatch(id, fetch, await insertPatch(dataset))
}
