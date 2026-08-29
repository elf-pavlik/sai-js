import type { DatasetCore, Quad } from '@rdfjs/types'
import { Store } from 'n3'
import { discoverDescriptionResource } from './discovery'
import { serializeTurtle } from './turtle-serializer'
import type { WhatwgFetch } from './whatwg-fetch'

export async function insertPatch(dataset: DatasetCore): Promise<string> {
  return `INSERT DATA { ${await serializeTurtle(dataset)} }`
}

export async function deletePatch(dataset: DatasetCore): Promise<string> {
  return `DELETE DATA { ${await serializeTurtle(dataset)} }`
}

/**
 * PATCH the description resource of a container with a SPARQL update.
 *
 * The description resource is discovered via HEAD + Link header unless
 * `descriptionResourceIri` is provided. Throws if the patch fails, if the
 * discovery HEAD fails, or if no description resource can be discovered.
 */
export async function applyPatch(
  containerIri: string,
  fetch: WhatwgFetch,
  sparqlUpdate: string,
  descriptionResourceIri?: string
): Promise<void> {
  let resourceIri = descriptionResourceIri
  if (!resourceIri) {
    const discovered = await discoverDescriptionResource(containerIri, fetch)
    if (!discovered) {
      throw new Error(`could not discover description resource of ${containerIri}`)
    }
    resourceIri = discovered
  }
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
