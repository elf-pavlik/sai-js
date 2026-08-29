import { INTEROP, RDF, type WhatwgFetch } from '@janeirodigital/interop-utils'
import { DataFactory, Store } from 'n3'
import type { DataModelDependencies } from '.'
import { linkedIrisJsonLd } from './context'
import { createContainer } from './container'
import { iriForContained as containerIriForContained } from './container'
import { type RoleData, putRole } from './role'

// ──────────────────────────
// Types
// ──────────────────────────

export type RoleRegistryData = {
  id: string
}

// ──────────────────────────
// Behavior functions (replacing class methods)
// ──────────────────────────

export async function containedIncludes(
  data: RoleRegistryData,
  fetch: WhatwgFetch,
  id: string
): Promise<boolean> {
  const iris = await linkedIrisJsonLd(data.id, fetch, 'contains')
  return iris.includes(id)
}

export async function createRole(
  data: RoleRegistryData,
  deps: DataModelDependencies,
  label: string,
  members: string[]
): Promise<RoleData> {
  const iri = iriForContained(data, deps.randomUUID)
  const role: RoleData = { id: iri, prefLabel: label, members, type: [INTEROP.Role] }
  await putRole(role, deps.fetch)
  return role
}

export async function updateRole(
  data: RoleRegistryData,
  fetch: WhatwgFetch,
  roleId: string,
  label: string,
  members: string[]
): Promise<RoleData> {
  const role: RoleData = { id: roleId, prefLabel: label, members, type: [INTEROP.Role] }
  await putRole(role, fetch)
  return role
}

export async function deleteRole(
  data: RoleRegistryData,
  fetch: WhatwgFetch,
  roleId: string
): Promise<void> {
  const { ok } = await fetch(roleId, { method: 'DELETE' })
  if (!ok) {
    throw new Error('failed to delete role')
  }
}

export async function createRoleRegistry(
  data: RoleRegistryData,
  fetch: WhatwgFetch
): Promise<void> {
  const dataset = new Store()
  dataset.add(
    DataFactory.quad(DataFactory.namedNode(data.id), RDF.terms.type, INTEROP.terms.RoleRegistry)
  )
  await createContainer(data.id, fetch, dataset)
}

export function iriForContained(
  data: RoleRegistryData,
  randomUUID: () => string,
  container = false
): string {
  return containerIriForContained(data.id, randomUUID, container)
}
