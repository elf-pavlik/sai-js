import { deletePatch, getDescriptionResource, insertPatch } from '@janeirodigital/interop-utils'
import type { DatasetCore, Quad } from '@rdfjs/types'
import { DataFactory, Store } from 'n3'
import type { AuthorizationAgentFactory } from '..'

/** Generate an IRI for a resource contained in the given container. */
export function iriForContained(
  containerIri: string,
  factory: { randomUUID(): string },
  container = false
): string {
  let containedIri = `${containerIri}${factory.randomUUID()}`
  if (container) containedIri += '/'
  return containedIri
}

/**
 * Discover the description resource IRI of a container via HEAD + Link header.
 */
async function discoverDescriptionResource(
  containerIri: string,
  factory: AuthorizationAgentFactory
): Promise<string> {
  const headResponse = await factory.fetch(containerIri, { method: 'HEAD' })
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
  factory: AuthorizationAgentFactory,
  sparqlUpdate: string,
  descriptionResourceIri?: string
): Promise<void> {
  const resourceIri =
    descriptionResourceIri ?? (await discoverDescriptionResource(containerIri, factory))
  const response = await factory.fetch(resourceIri, {
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
  factory: AuthorizationAgentFactory,
  quad: Quad
): Promise<void> {
  await applyPatch(containerIri, factory, await insertPatch(new Store([quad])))
}

/** Remove a statement from a container via SPARQL patch. */
export async function removeStatement(
  containerIri: string,
  factory: AuthorizationAgentFactory,
  quad: Quad
): Promise<void> {
  await applyPatch(containerIri, factory, await deletePatch(new Store([quad])))
}

/** Replace a statement in a container via SPARQL patch. */
export async function replaceStatement(
  containerIri: string,
  factory: AuthorizationAgentFactory,
  whichQuad: Quad,
  withQuad: Quad
): Promise<void> {
  const sparqlUpdate = [
    await deletePatch(new Store([whichQuad])),
    await insertPatch(new Store([withQuad])),
  ].join(';')
  await applyPatch(containerIri, factory, sparqlUpdate)
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
  iri: string,
  factory: AuthorizationAgentFactory,
  dataset: DatasetCore
): Promise<void> {
  // create empty container, CSS ignores body!
  const response = await factory.fetch(iri, { method: 'PUT' })
  if (!response.ok) {
    console.error(response)
    throw new Error('failed to create empty container')
  }

  await applyPatch(iri, factory, await insertPatch(dataset))
}
