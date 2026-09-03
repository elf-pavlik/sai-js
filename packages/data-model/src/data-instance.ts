import {
  type JsonLdContext,
  SHAPETREES,
  type WhatwgFetch,
  fetchJsonLd,
  frameDoc,
  framedValue,
} from '@janeirodigital/interop-utils'
import { dataModelContext } from './context'
import type { DataRegistrationData } from './data-registration'
import type { ShapeTreeData } from './shape-tree'

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
    // the shared context maps `label` to skos:prefLabel; without
    // describesInstance the term must not pick up stray prefLabel values on
    // instance documents
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
