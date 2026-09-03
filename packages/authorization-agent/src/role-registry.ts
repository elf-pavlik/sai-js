import { type RoleData, type RoleRegistryData, dataModelContext } from '@janeirodigital/interop-data-model'
import type { DataModelDependencies } from './types'
import {
  INTEROP,
  LDP,
  type WhatwgFetch,
  iriForContained,
  linkedIrisJsonLd,
  putJsonLd,
  withContext,
} from '@janeirodigital/interop-utils'

// ──────────────────────────
// Write path: RoleData → JSON-LD (PUT)
// ──────────────────────────

export async function putRole(data: RoleData, fetch: WhatwgFetch): Promise<void> {
  await putJsonLd(data.id, fetch, withContext(dataModelContext, data))
}

// ──────────────────────────
// Behavior functions (replacing class methods)
// ──────────────────────────

export async function containedIncludes(
  data: RoleRegistryData,
  fetch: WhatwgFetch,
  id: string
): Promise<boolean> {
  const iris = await linkedIrisJsonLd(data.id, fetch, LDP.contains)
  return iris.includes(id)
}

export async function createRole(
  data: RoleRegistryData,
  deps: DataModelDependencies,
  label: string,
  members: string[]
): Promise<RoleData> {
  const iri = iriForContained(data, deps.randomUUID)
  const role: RoleData = { id: iri, label: label, members, type: [INTEROP.Role] }
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
  const role: RoleData = { id: roleId, label: label, members, type: [INTEROP.Role] }
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
