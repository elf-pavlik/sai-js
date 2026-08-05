import { INTEROP, LDP, RDF } from '@janeirodigital/interop-utils'
import { DataFactory, Store } from 'n3'
import type { AuthorizationAgentFactory } from '..'
import { CRUDContainer } from './container'
import { iriForContained as containerIriForContained } from './container'
import { linkedIris } from './resource'
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

export async function* roles(
  data: RoleRegistryData,
  factory: AuthorizationAgentFactory
): AsyncIterable<RoleData> {
  const iris = await linkedIris(data.id, factory, LDP.contains)
  for (const iri of iris) {
    yield factory.crud.role(iri)
  }
}

export async function containedIncludes(
  data: RoleRegistryData,
  factory: AuthorizationAgentFactory,
  id: string
): Promise<boolean> {
  const iris = await linkedIris(data.id, factory, LDP.contains)
  return iris.includes(id)
}

export async function createRole(
  data: RoleRegistryData,
  factory: AuthorizationAgentFactory,
  label: string,
  members: string[]
): Promise<RoleData> {
  const iri = iriForContained(data, factory)
  const role: RoleData = { id: iri, label, members }
  await putRole(role, factory)
  return role
}

export async function updateRole(
  data: RoleRegistryData,
  factory: AuthorizationAgentFactory,
  roleId: string,
  label: string,
  members: string[]
): Promise<RoleData> {
  const role: RoleData = { id: roleId, label, members }
  await putRole(role, factory)
  return role
}

export async function deleteRole(
  data: RoleRegistryData,
  factory: AuthorizationAgentFactory,
  roleId: string
): Promise<void> {
  const { ok } = await factory.fetch(roleId, { method: 'DELETE' })
  if (!ok) {
    throw new Error('failed to delete role')
  }
}

export async function createRoleRegistry(
  data: RoleRegistryData,
  factory: AuthorizationAgentFactory
): Promise<void> {
  const dataset = new Store()
  dataset.add(DataFactory.quad(DataFactory.namedNode(data.id), RDF.type, INTEROP.RoleRegistry))
  const container = new CRUDContainer(data.id, factory, {})
  container.dataset = dataset
  await container.create()
}

export function iriForContained(
  data: RoleRegistryData,
  factory: AuthorizationAgentFactory,
  container = false
): string {
  return containerIriForContained(data.id, factory, container)
}
