import { INTEROP, RDF, SKOS, getAllMatchingQuads, getOneMatchingQuad } from '@janeirodigital/interop-utils'
import { DataFactory, Store } from 'n3'
import type { AuthorizationAgentFactory } from '..'
import { CRUDResource, fetchDataset } from './resource'

// ──────────────────────────
// Types
// ──────────────────────────

export type RoleData = {
  id: string
  label: string
  members: string[]
}

// ──────────────────────────
// Read path: Dataset → RoleData
// ──────────────────────────

export async function loadRole(
  iri: string,
  factory: AuthorizationAgentFactory
): Promise<RoleData> {
  const dataset = await fetchDataset(iri, factory)
  const node = DataFactory.namedNode(iri)
  return {
    id: iri,
    label: getOneMatchingQuad(dataset, node, SKOS.prefLabel)?.object.value ?? '',
    members: getAllMatchingQuads(dataset, node, INTEROP.hasMember).map((quad) => quad.object.value),
  }
}

// ──────────────────────────
// Write path: RoleData → Dataset (PUT)
// ──────────────────────────

export async function putRole(
  data: RoleData,
  factory: AuthorizationAgentFactory
): Promise<void> {
  const dataset = new Store()
  const node = DataFactory.namedNode(data.id)
  dataset.add(DataFactory.quad(node, RDF.type, INTEROP.Role))
  dataset.add(DataFactory.quad(node, SKOS.prefLabel, DataFactory.literal(data.label)))
  for (const member of data.members) {
    dataset.add(DataFactory.quad(node, INTEROP.hasMember, DataFactory.namedNode(member)))
  }
  const resource = new CRUDResource(data.id, factory, data)
  resource.dataset = dataset
  await resource.update()
}
