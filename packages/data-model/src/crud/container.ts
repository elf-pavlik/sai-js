import {
  LDP,
  deletePatch,
  getDescriptionResource,
  insertPatch,
} from '@janeirodigital/interop-utils'
import type { Quad } from '@rdfjs/types'
import { Store } from 'n3'
import { CRUDResource } from '.'
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

/** Add a statement to a container via SPARQL patch. */
export async function addStatement(
  containerIri: string,
  factory: AuthorizationAgentFactory,
  quad: Quad
): Promise<void> {
  const container = new CRUDContainer(containerIri, factory)
  await container.addStatement(quad)
}

/** Remove a statement from a container via SPARQL patch. */
export async function removeStatement(
  containerIri: string,
  factory: AuthorizationAgentFactory,
  quad: Quad
): Promise<void> {
  const container = new CRUDContainer(containerIri, factory)
  await container.removeStatement(quad)
}

/** Replace a statement in a container via SPARQL patch. */
export async function replaceStatement(
  containerIri: string,
  factory: AuthorizationAgentFactory,
  whichQuad: Quad,
  withQuad: Quad
): Promise<void> {
  const container = new CRUDContainer(containerIri, factory)
  await container.replaceStatement(whichQuad, withQuad)
}

// TODO combine with ReadableContainer as mixin
export class CRUDContainer extends CRUDResource {
  descriptionResourceIri?: string

  public iriForContained(container = false): string {
    let containedIri = `${this.iri}${this.factory.randomUUID()}`
    if (container) containedIri += '/'
    return containedIri
  }

  public containedIncludes(id: string): boolean {
    return this.getObjectsArray(LDP.contains)
      .map((node) => node.value)
      .includes(id)
  }

  public async applyPatch(sparqlUpdate: string, create = false): Promise<void> {
    await this.discoverDescriptionResource()
    // update the Description Resource
    const headers: { [key: string]: string } = {
      'Content-Type': 'application/sparql-update',
    }
    // FIXME: CSS (auth instance) fails on else
    // if (create) {
    //   headers['If-None-Match'] = '*'
    // } else {
    //   headers['If-Match'] = '*'
    // }
    const response = await this.fetch(this.descriptionResourceIri, {
      method: 'PATCH',
      body: sparqlUpdate,
      headers,
    })
    if (!response.ok) {
      throw new Error(`failed to patch ${this.descriptionResourceIri}`)
    }
  }

  public async addStatement(quad: Quad): Promise<void> {
    const sparqlUpdate = await insertPatch(new Store([quad]))
    await this.applyPatch(sparqlUpdate)
    this.dataset.add(quad)
  }

  public async removeStatement(quad: Quad): Promise<void> {
    const sparqlUpdate = await deletePatch(new Store([quad]))
    await this.applyPatch(sparqlUpdate)
    this.dataset.delete(quad)
  }

  public async replaceStatement(whichQuad: Quad, withQuad: Quad): Promise<void> {
    const sparqlUpdate = [
      await deletePatch(new Store([whichQuad])),
      await insertPatch(new Store([withQuad])),
    ].join(';')
    await this.applyPatch(sparqlUpdate)
    this.dataset.delete(whichQuad)
    this.dataset.add(withQuad)
  }

  private async discoverDescriptionResource(): Promise<string> {
    if (this.descriptionResourceIri) return this.descriptionResourceIri
    const headResponse = await this.fetch(this.iri, {
      method: 'HEAD',
    })

    this.descriptionResourceIri = getDescriptionResource(headResponse.headers.get('Link'))
    return this.descriptionResourceIri
  }

  /*
   * @throws Error if fails
   */
  public async create(): Promise<void> {
    this.setTimestampsAndAgents()

    // create empty container, CSS ignores body!
    {
      const response = await this.fetch(this.iri, {
        method: 'PUT',
      })
      if (!response.ok) {
        console.error(response)
        throw new Error('failed to create empty container')
      }
    }

    await this.discoverDescriptionResource()
    const sparqlUpdate = await insertPatch(this.dataset)
    await this.applyPatch(sparqlUpdate, true)
  }
}
