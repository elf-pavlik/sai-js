import {
  INTEROP,
  SHAPETREES,
  buildNamespace,
  getAllMatchingQuads,
  getDescriptionResource,
  getOneMatchingQuad,
  insertPatch,
  parseJsonld,
  targetDataRegistrationLink,
} from '@janeirodigital/interop-utils'
import type { DatasetCore } from '@rdfjs/types'
import { DataFactory, type NamedNode } from 'n3'
import type { ApplicationFactory, InteropFactory } from '.'
import type { DataRegistrationData } from './data-registration'
import type { GrantData } from './grant'
import type { ShapeTreeData } from './shape-tree'
import { ReadableResource } from './readable/resource'
import {
  getDescription as getShapeTreeDescription,
  getPredicateForReferenced,
  expectsType,
} from './shape-tree'
import * as Grant from './grant'

const NFO = buildNamespace('http://www.semanticdesktop.org/ontologies/2007/03/22/nfo#')

// ──────────────────────────
// DataInstanceData (readable POJO)
// ──────────────────────────

export type ChildInfo = {
  shapeTree: {
    iri: string
    label: string
  }
  count: number
}

/** Plain JSON representation of a data instance. */
export type DataInstanceData = {
  id: string
  shapeTreeIri?: string
  label?: string
  isBlob: boolean
  children: ChildInfo[]
  dataRegistration?: DataRegistrationData
}

// ──────────────────────────
// Behavior functions (replacing class methods)
// ──────────────────────────

/** Whether the shape tree expects non-RDF resources (blobs). */
export function isBlob(shapeTree: ShapeTreeData): boolean {
  return shapeTree.expectsType === SHAPETREES.NonRDFResource.value
}

/** Fetch the data instance's RDF dataset (or blob description resource). */
export async function fetchDataInstanceDataset(
  iri: string,
  factory: InteropFactory
): Promise<DatasetCore> {
  const response = await factory.fetch.raw(iri, {
    headers: { Accept: 'application/ld+json' },
  })
  const doc = await response.json()
  return parseJsonld(JSON.stringify(doc), iri)
}

/** Resolve the description resource IRI of a blob from its Link header. */
export async function discoverDescriptionResource(
  iri: string,
  fetch: InteropFactory['fetch']
): Promise<string> {
  const response = await fetch.raw(iri, { method: 'HEAD' })
  return getDescriptionResource(response.headers.get('Link'))
}

export function computeLabel(
  dataset: DatasetCore,
  id: string,
  shapeTree: ShapeTreeData
): string | undefined {
  const node = DataFactory.namedNode(id)
  let label: string | undefined
  const describesInstance = shapeTree.describesInstance
  if (describesInstance) {
    label = getOneMatchingQuad(dataset, node, DataFactory.namedNode(describesInstance))?.object
      .value
  }
  return label || getOneMatchingQuad(dataset, node, NFO.fileName)?.object.value
}

export async function computeChildren(
  dataset: DatasetCore,
  id: string,
  shapeTree: ShapeTreeData,
  factory: InteropFactory,
  lang: string
): Promise<ChildInfo[]> {
  return Promise.all(
    shapeTree.references.map(async (reference) => {
      const childTree = await factory.readable.shapeTree(reference.shapeTree)
      const description = await getShapeTreeDescription(childTree, lang, factory)
      return {
        count: getAllMatchingQuads(dataset, DataFactory.namedNode(id), reference.viaPredicate)
          .length,
        shapeTree: { iri: reference.shapeTree, label: description?.label },
      }
    })
  )
}

/** The data instance's label (describesInstance value or nfo:fileName). */
export async function label(
  data: DataInstanceData,
  factory: InteropFactory
): Promise<string | undefined> {
  if (!data.shapeTreeIri) return undefined
  const [shapeTree, dataset] = await Promise.all([
    factory.readable.shapeTree(data.shapeTreeIri),
    fetchDataInstanceDataset(data.id, factory),
  ])
  return computeLabel(dataset, data.id, shapeTree)
}

/** Count the children of the data instance for each referenced shape tree. */
export async function buildChildrenInfo(
  data: DataInstanceData,
  factory: InteropFactory,
  lang: string
): Promise<ChildInfo[]> {
  if (!data.shapeTreeIri) return []
  const [shapeTree, dataset] = await Promise.all([
    factory.readable.shapeTree(data.shapeTreeIri),
    fetchDataInstanceDataset(data.id, factory),
  ])
  return computeChildren(dataset, data.id, shapeTree, factory, lang)
}

// ──────────────────────────
// DataInstance (write-side active record)
// ──────────────────────────

export class DataInstance extends ReadableResource {
  dataGrant: GrantData

  parent: DataInstance

  draft: boolean

  shapeTree: ShapeTreeData

  public constructor(
    iri: string,
    dataGrant: GrantData,
    factory: ApplicationFactory,
    parent?: DataInstance,
    draft = false
  ) {
    super(iri, factory)
    this.dataGrant = dataGrant
    this.parent = parent
    this.draft = draft
  }

  private async bootstrap(): Promise<void> {
    this.shapeTree = await this.factory.readable.shapeTree(this.dataGrant.registeredShapeTree)
    if (!this.draft) {
      if (!this.isBlob) {
        await this.fetchData()
      } else {
        const descriptionIri = await this.discoverDescriptionResource()
        const response = await this.fetch(descriptionIri)
        this.dataset = await response.dataset()
      }
    }
  }

  // TODO: extract as mixin from container
  async discoverDescriptionResource(): Promise<string> {
    return discoverDescriptionResource(this.iri, this.fetch)
  }

  public static async build(
    iri: string,
    dataGrant: GrantData,
    factory: ApplicationFactory,
    parent?: DataInstance,
    draft = false
  ): Promise<DataInstance> {
    const instance = new DataInstance(iri, dataGrant, factory, parent, draft)
    await instance.bootstrap()
    return instance
  }

  public replaceValue(predicate: NamedNode, value: string) {
    const oldQuad = this.getQuad(this.node, predicate)
    if (oldQuad) this.dataset.delete(oldQuad)
    const newQuad = DataFactory.quad(this.node, predicate, DataFactory.literal(value))
    this.dataset.add(newQuad)
  }

  /*
   * @throws Error if fails
   */
  public async delete(): Promise<void> {
    if (!this.draft) {
      const { ok } = await this.fetch(this.iri, { method: 'DELETE' })
      if (!ok) {
        throw new Error('failed to delete')
      }
      // must be done after deleting
      if (this.parent) {
        await this.parent.updateRemovingChildReference(this)
      }
    }
  }

  /*
   * @param dataset - dataset to replace current one with
   * @throws Error if fails
   */
  public async update(dataset: DatasetCore, file?: File): Promise<void> {
    // must be done before creating
    if (this.parent && this.draft) {
      await this.parent.updateAddingChildReference(this)
    }

    if (this.isBlob) {
      if (this.draft && !file) {
        throw new Error('new non RDF resource needs the blob')
      }

      if (file) {
        // TODO: refactor RdfFetch
        // @ts-ignore
        const { ok } = await this.fetch.raw(this.iri, {
          method: 'PUT',
          headers: { 'Content-Type': file.type },
          body: file,
        })

        if (!ok) {
          throw new Error('failed to upload file')
        }
      }

      const descriptionIri = await this.discoverDescriptionResource()

      // TODO support update, now only create will work
      // TODO reuse from CRUD Container
      const { ok } = await this.fetch(descriptionIri, {
        method: 'PATCH',
        body: await insertPatch(this.dataset),
        headers: {
          'Content-Type': 'application/sparql-update',
        },
      })
      if (!ok) {
        throw new Error(`failed to patch ${descriptionIri}`)
      }
    } else {
      const { ok } = await this.fetch(this.iri, {
        method: 'PUT',
        dataset,
        headers: { Link: targetDataRegistrationLink(this.dataGrant.hasDataRegistration) },
      })
      if (!ok) {
        throw new Error('failed to update')
      }
    }

    this.draft = false
    this.dataset = dataset
  }

  async getChildReferencesForShapeTree(shapeTree: string): Promise<string[]> {
    const predicate = getPredicateForReferenced(this.shapeTree, shapeTree)
    return this.getObjectsArray(predicate).map((object) => object.value)
  }

  async findChildGrant(shapeTree: string): Promise<GrantData | undefined> {
    if (this.dataGrant.scopeOfGrant === INTEROP.Inherited.value) {
      throw new Error('child instance can not have child instances')
    }
    for (const childIri of this.dataGrant.hasInheritingGrant ?? []) {
      const childGrant = await this.factory.readable.dataGrant(childIri)
      if (childGrant.registeredShapeTree === shapeTree) {
        return childGrant
      }
    }
    return undefined
  }

  async getChildInstancesIterator(shapeTree: string): Promise<AsyncIterable<DataInstance>> {
    const childGrant = await this.findChildGrant(shapeTree)
    if (!childGrant) throw new Error(`No child grant found for shape tree ${shapeTree}`)
    const instance = this
    const references = await instance.getChildReferencesForShapeTree(shapeTree)
    return {
      async *[Symbol.asyncIterator]() {
        for (const childInstanceIri of references) {
          yield instance.factory.dataInstance(childInstanceIri, childGrant!, instance)
        }
      },
    }
  }

  async newChildDataInstance(shapeTree: string): Promise<DataInstance> {
    const childGrant = await this.findChildGrant(shapeTree)
    if (!childGrant) throw new Error(`No child grant found for shape tree ${shapeTree}`)
    return Grant.newDataInstance(childGrant, this.factory, this.factory.randomUUID, this)
  }

  get accessMode(): string[] {
    return this.dataGrant.accessMode ?? []
  }

  public async updateAddingChildReference(child: DataInstance): Promise<void> {
    const predicate = getPredicateForReferenced(this.shapeTree, child.dataGrant.registeredShapeTree)

    const referenceQuad = DataFactory.quad(
      DataFactory.namedNode(this.iri),
      predicate,
      DataFactory.namedNode(child.iri),
      [...this.dataset][0].graph
    )
    this.dataset.add(referenceQuad)
    await this.update(this.dataset)
  }

  public async updateRemovingChildReference(child: DataInstance): Promise<void> {
    const predicate = getPredicateForReferenced(this.shapeTree, child.dataGrant.registeredShapeTree)

    const referenceQuad = DataFactory.quad(
      DataFactory.namedNode(this.iri),
      predicate,
      DataFactory.namedNode(child.iri),
      [...this.dataset][0].graph
    )
    this.dataset.delete(referenceQuad)
    await this.update(this.dataset)
  }

  addNode(predicate: string, object: string) {
    this.dataset.add(
      DataFactory.quad(this.node, DataFactory.namedNode(predicate), DataFactory.namedNode(object))
    )
  }

  get isBlob(): boolean {
    return expectsType(this.shapeTree).value === SHAPETREES.NonRDFResource.value
  }

  async fetchBlob(): Promise<Blob> {
    // @ts-ignore
    return (await this.fetch.raw(this.iri)).blob()
  }
}
