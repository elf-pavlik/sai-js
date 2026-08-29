import { deletePatch, getDescriptionResource, insertPatch } from '@janeirodigital/interop-utils'
import type { WhatwgFetch } from '@janeirodigital/interop-utils'
import type { DatasetCore, Quad } from '@rdfjs/types'
import { DataFactory, Store } from 'n3'

/** Generate an IRI for a resource contained in the given container. */
export function iriForContained(
  containerIri: string,
  randomUUID: () => string,
  container = false
): string {
  let containedIri = `${containerIri}${randomUUID()}`
  if (container) containedIri += '/'
  return containedIri
}

/**
 * Discover the description resource IRI of a container via HEAD + Link header.
 */
async function discoverDescriptionResource(
  containerIri: string,
  fetch: WhatwgFetch
): Promise<string> {
  const headResponse = await fetch(containerIri, { method: 'HEAD' })
  return getDescriptionResource(headResponse.headers.get('Link'))
}

/**
 * PATCH the description resource of a container with a SPARQL update.
 *
 * The description resource is discovered via HEAD + Link header unless
 * `descriptionResourceIri` is provided. Throws if the patch fails.
 */
export async function applyPatch(
  containerIri: string,
  fetch: WhatwgFetch,
  sparqlUpdate: string,
  descriptionResourceIri?: string
): Promise<void> {
  const resourceIri =
    descriptionResourceIri ?? (await discoverDescriptionResource(containerIri, fetch))
  const response = await fetch(resourceIri, {
    method: 'PATCH',
    body: sparqlUpdate,
    headers: { 'Content-Type': 'application/sparql-update' },
  })
  if (!response.ok) {
    const body = response.text ? await response.text().catch(() => '') : ''
    throw new Error(`failed to patch ${resourceIri}: ${response.status} - ${body}`)
  }
}

/** Add a statement to a container via SPARQL patch. */
export async function addStatement(
  containerIri: string,
  fetch: WhatwgFetch,
  quad: Quad
): Promise<void> {
  await applyPatch(containerIri, fetch, await insertPatch(new Store([quad])))
}

/** Remove a statement from a container via SPARQL patch. */
export async function removeStatement(
  containerIri: string,
  fetch: WhatwgFetch,
  quad: Quad
): Promise<void> {
  await applyPatch(containerIri, fetch, await deletePatch(new Store([quad])))
}

/** Replace a statement in a container via SPARQL patch. */
export async function replaceStatement(
  containerIri: string,
  fetch: WhatwgFetch,
  whichQuad: Quad,
  withQuad: Quad
): Promise<void> {
  const sparqlUpdate = [
    await deletePatch(new Store([whichQuad])),
    await insertPatch(new Store([withQuad])),
  ].join(';')
  await applyPatch(containerIri, fetch, sparqlUpdate)
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
