import {
  type ChildInfo,
  type DataInstanceData,
  type DataRegistrationData,
  ShapeTree,
  childIris,
  frameDataInstance,
  isBlob,
  labelFromNode,
  loadDataRegistration,
  loadShapeTree,
} from '@janeirodigital/interop-data-model'
import type { ShapeTreeData } from '@janeirodigital/interop-data-model'
import { type WhatwgFetch, discoverDescriptionResource } from '@janeirodigital/interop-utils'

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
      const description = await ShapeTree.getDescription(childTree, lang, fetch)
      return {
        count: ((node[reference.viaPredicate.value] as string[] | undefined) ?? []).length,
        shapeTree: { id: reference.shapeTree, label: description?.label },
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
