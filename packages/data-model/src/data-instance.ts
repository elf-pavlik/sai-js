import {
  type JsonLdContext,
  SHAPETREES,
  type WhatwgFetch,
  fetchJsonLd,
  frameDoc,
  framedValue,
  getDescriptionResource,
} from '@janeirodigital/interop-utils'
import { dataModelContext } from './context'
import type { DataRegistrationData } from './data-registration'
import { loadDataRegistration } from './data-registration'
import type { ShapeTreeData } from './shape-tree'
import { getDescription as getShapeTreeDescription, loadShapeTree } from './shape-tree'

// ──────────────────────────
// DataInstanceData (readable POJO)
// ──────────────────────────

export type ChildInfo = {
  shapeTree: {
    id: string
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
// Read helpers (framed JSON-LD, no N3 / quad lookups)
// ──────────────────────────

/** Whether the shape tree expects non-RDF resources (blobs). */
export function isBlob(shapeTree: ShapeTreeData): boolean {
  return shapeTree.expectsType === SHAPETREES.NonRDFResource
}

/** Resolve the description resource IRI of a blob from its Link header. */
export async function discoverDescriptionResource(id: string, fetch: WhatwgFetch): Promise<string> {
  const response = await fetch(id, { method: 'HEAD' })
  return getDescriptionResource(response.headers.get('Link'))
}

/**
 * JSON-LD context for framing a data instance document: the shared
 * `dataModelContext` with per-shape-tree overrides — the tree's
 * `describesInstance` predicate maps to `label`, `nfo:fileName` to
 * `fileName`, and each reference's `viaPredicate` IRI is its own key (values
 * are the referenced child instance IRIs).
 */
function dataInstanceContext(shapeTree: ShapeTreeData): JsonLdContext {
  const context: JsonLdContext = { ...dataModelContext }
  if (shapeTree.describesInstance) {
    context.label = { '@id': shapeTree.describesInstance }
  } else {
    // the shared context maps `label` to rdfs:label; without describesInstance
    // the term must not pick up stray rdfs:label values on instance documents
    delete context.label
  }
  context.fileName = { '@id': 'http://www.semanticdesktop.org/ontologies/2007/03/22/nfo#fileName' }
  shapeTree.references.forEach((reference) => {
    context[reference.viaPredicate.value] = {
      '@id': reference.viaPredicate.value,
      '@type': '@id',
      '@container': '@set',
    }
  })
  return context
}

/**
 * Frame an already-fetched data instance document into a single JSON-LD
 * node — no fetch. The org-context counterpart of `frameDataInstance`:
 * the caller fetches the peer document through `/proxy-admin`
 * (org-context-proxy.md) and parses here — the admin's session cannot
 * deref peer documents, and the org session never exists on the admin's
 * server.
 */
export async function frameDataInstanceFromDoc(
  doc: unknown,
  id: string,
  shapeTree: ShapeTreeData
): Promise<Record<string, unknown>> {
  return frameDoc(doc, dataInstanceContext(shapeTree), id)
}

/**
 * Fetch and frame a data instance document into a single JSON-LD node —
 * the JSON-LD replacement for the fetchDataInstanceDataset +
 * computeLabel/computeChildren quad lookups.
 *
 * For blobs, `docIri` is the description resource while `iri` stays the blob
 * IRI (the description resource describes the blob, i.e. contains it as the
 * framed subject).
 */
export async function frameDataInstance(
  id: string,
  fetch: WhatwgFetch,
  shapeTree: ShapeTreeData,
  docIri?: string
): Promise<Record<string, unknown>> {
  return frameDataInstanceFromDoc(await fetchJsonLd(docIri ?? id, fetch), id, shapeTree)
}

/** The data instance's label (describesInstance value or nfo:fileName). */
export function labelFromNode(node: Record<string, unknown>): string | undefined {
  return framedValue(node.label) ?? framedValue(node.fileName)
}

/**
 * Child instance IRIs of the data instance for the shape tree referenced
 * via `childShapeTree`.
 */
export function childIris(
  node: Record<string, unknown>,
  shapeTree: ShapeTreeData,
  childShapeTree: string
): string[] {
  const reference = shapeTree.references.find((reference) => reference.shapeTree === childShapeTree)
  if (!reference) {
    throw new Error(`shape tree ${shapeTree.id} does not reference ${childShapeTree}`)
  }
  return (node[reference.viaPredicate.value] as string[] | undefined) ?? []
}

/** Count the children of the data instance for each referenced shape tree. */
export async function computeChildren(
  node: Record<string, unknown>,
  shapeTree: ShapeTreeData,
  fetch: WhatwgFetch,
  lang: string
): Promise<ChildInfo[]> {
  return Promise.all(
    shapeTree.references.map(async (reference) => {
      const childTree = await loadShapeTree(reference.shapeTree, fetch)
      const description = await getShapeTreeDescription(childTree, lang, fetch)
      return {
        count: ((node[reference.viaPredicate.value] as string[] | undefined) ?? []).length,
        shapeTree: { id: reference.shapeTree, label: description?.prefLabel },
      }
    })
  )
}

/**
 * Fetch and load a data instance as a DataInstanceData POJO — the composed
 * read formerly `ApplicationFactory.dataInstance`: resolves the instance's
 * data registration, its shape tree, and (with `descriptionLang`) the
 * instance's label and children.
 */
export async function loadDataInstance(
  id: string,
  fetch: WhatwgFetch,
  shapeTreeIri?: string,
  descriptionLang?: string
): Promise<DataInstanceData> {
  let dataRegistration: DataRegistrationData | undefined
  let resolvedShapeTreeIri = shapeTreeIri
  if (!resolvedShapeTreeIri) {
    const dataRegistrationIri = `${id.split('/').slice(0, -1).join('/')}/`
    dataRegistration = await loadDataRegistration(dataRegistrationIri, fetch)
    resolvedShapeTreeIri = dataRegistration.registeredShapeTree
  }
  const shapeTree = await loadShapeTree(resolvedShapeTreeIri, fetch)
  const blob = isBlob(shapeTree)
  const data: DataInstanceData = {
    id: id,
    shapeTreeIri: resolvedShapeTreeIri,
    isBlob: blob,
    children: [],
    dataRegistration,
  }
  if (descriptionLang) {
    const node = blob
      ? await frameDataInstance(id, fetch, shapeTree, await discoverDescriptionResource(id, fetch))
      : await frameDataInstance(id, fetch, shapeTree)
    data.label = labelFromNode(node)
    data.children = await computeChildren(node, shapeTree, fetch, descriptionLang)
  }
  return data
}
