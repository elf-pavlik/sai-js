import {
  INTEROP,
  RDF,
  type WhatwgFetch,
  fetchJsonLd,
  frameDoc,
  putJsonLd,
  withContext,
} from '@janeirodigital/interop-utils'
import { DataFactory, Store } from 'n3'
import type { DataModelDependencies } from '..'
import { dataModelContext, linkedIrisJsonLd } from '../context'
import { iriForContained as containerIriForContained, createContainer } from './container'

// ──────────────────────────
// Types
// ──────────────────────────

export type AuthorizationRegistryData = {
  id: string
}

/** Identity + marking fields of an AdminAuthorization resource (phase-1 internal read). */
export type AdminAuthorizationData = {
  id: string

  /** rdf:type IRIs — captured from framing on read, written on PUT */
  type: string[]

  grantee: string
  grantedBy: string
  scopeOfAuthorization: string
}

// ──────────────────────────
// Functional helpers for reading the contained data authorizations
// ──────────────────────────

export async function getDataAuthorizationIris(
  data: AuthorizationRegistryData,
  fetch: WhatwgFetch
): Promise<string[]> {
  return linkedIrisJsonLd(data.id, fetch, 'contains')
}

export async function getGranted(
  data: AuthorizationRegistryData,
  fetch: WhatwgFetch
): Promise<boolean> {
  return (await getDataAuthorizationIris(data, fetch)).length > 0
}

// ──────────────────────────
// AdminAuthorization — internal read + write (R1; public iteration deferred)
// ──────────────────────────

/** Load an AdminAuthorization resource as an AdminAuthorizationData POJO. */
async function loadAdminAuthorization(
  id: string,
  fetch: WhatwgFetch
): Promise<AdminAuthorizationData> {
  const node = (await frameDoc(await fetchJsonLd(id, fetch), dataModelContext, id)) as any
  return {
    id: id,
    type: node.type ? (Array.isArray(node.type) ? node.type : [node.type]) : [],
    grantee: node.grantee,
    grantedBy: node.grantedBy,
    scopeOfAuthorization: node.scopeOfAuthorization,
  }
}

/**
 * Iterate the AdminAuthorizations in the registry (type-filtered; used by the
 * RPC last-admin guard and the syncAdminAcr workflow).
 */
export async function* adminAuthorizations(
  data: AuthorizationRegistryData,
  fetch: WhatwgFetch
): AsyncIterable<AdminAuthorizationData> {
  const iris = await getDataAuthorizationIris(data, fetch)
  for (const iri of iris) {
    const adminAuthorization = await loadAdminAuthorization(iri, fetch)
    if (adminAuthorization.type.includes(INTEROP.AdminAuthorization)) {
      yield adminAuthorization
    }
  }
}

/** Find the AdminAuthorization for a grantee, if any. */
export async function findAdminAuthorization(
  data: AuthorizationRegistryData,
  fetch: WhatwgFetch,
  grantee: string
): Promise<AdminAuthorizationData | undefined> {
  for await (const adminAuthorization of adminAuthorizations(data, fetch)) {
    if (adminAuthorization.grantee === grantee) {
      return adminAuthorization
    }
  }
  return undefined
}

/**
 * Record an AdminAuthorization in the org's AuthorizationRegistry — PUT via
 * iriForContained (containment is server-managed, matching data authorizations).
 */
export async function recordAdminAuthorization(
  data: AuthorizationRegistryData,
  deps: DataModelDependencies,
  adminAuthorization: Pick<AdminAuthorizationData, 'grantee' | 'grantedBy' | 'scopeOfAuthorization'>
): Promise<AdminAuthorizationData> {
  const iri = iriForContained(data, deps.randomUUID)
  const doc = withContext(dataModelContext, {
    ...adminAuthorization,
    id: iri,
    type: [INTEROP.AdminAuthorization],
  })
  await putJsonLd(iri, deps.fetch, doc, { 'If-None-Match': '*' })
  return { id: iri, type: [INTEROP.AdminAuthorization], ...adminAuthorization }
}

/** Delete an AdminAuthorization resource from the org's AuthorizationRegistry. */
export async function deleteAdminAuthorization(id: string, fetch: WhatwgFetch): Promise<void> {
  const response = await fetch(id, { method: 'DELETE' })
  if (!response.ok) {
    throw new Error(`failed to delete admin authorization: ${response.status}`)
  }
}

export async function createAuthorizationRegistry(
  data: AuthorizationRegistryData,
  fetch: WhatwgFetch
): Promise<void> {
  const dataset = new Store()
  dataset.add(
    DataFactory.quad(
      DataFactory.namedNode(data.id),
      RDF.terms.type,
      INTEROP.terms.AuthorizationRegistry
    )
  )
  await createContainer(data.id, fetch, dataset)
}

export function iriForContained(
  data: AuthorizationRegistryData,
  randomUUID: () => string,
  container = false
): string {
  return containerIriForContained(data.id, randomUUID, container)
}
