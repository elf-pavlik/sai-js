import {
  INTEROP,
  RDF,
  fetchJsonLd,
  frameDoc,
  putJsonLd,
  withContext,
} from '@janeirodigital/interop-utils'
import { DataFactory, Store } from 'n3'
import type { AuthorizationAgentFactory } from '..'
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
  factory: AuthorizationAgentFactory
): Promise<string[]> {
  return linkedIrisJsonLd(data.id, factory.fetch, 'contains')
}

export async function getGranted(
  data: AuthorizationRegistryData,
  factory: AuthorizationAgentFactory
): Promise<boolean> {
  return (await getDataAuthorizationIris(data, factory)).length > 0
}

// ──────────────────────────
// AdminAuthorization — internal read + write (R1; public iteration deferred)
// ──────────────────────────

/** Load an AdminAuthorization resource as an AdminAuthorizationData POJO. */
async function loadAdminAuthorization(
  iri: string,
  factory: AuthorizationAgentFactory
): Promise<AdminAuthorizationData> {
  const node = (await frameDoc(await fetchJsonLd(iri, factory.fetch), dataModelContext, iri)) as any
  return {
    id: iri,
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
  factory: AuthorizationAgentFactory
): AsyncIterable<AdminAuthorizationData> {
  const iris = await getDataAuthorizationIris(data, factory)
  for (const iri of iris) {
    const adminAuthorization = await loadAdminAuthorization(iri, factory)
    if (adminAuthorization.type.includes(INTEROP.AdminAuthorization)) {
      yield adminAuthorization
    }
  }
}

/** Find the AdminAuthorization for a grantee, if any. */
export async function findAdminAuthorization(
  data: AuthorizationRegistryData,
  factory: AuthorizationAgentFactory,
  grantee: string
): Promise<AdminAuthorizationData | undefined> {
  for await (const adminAuthorization of adminAuthorizations(data, factory)) {
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
  factory: AuthorizationAgentFactory,
  adminAuthorization: Pick<AdminAuthorizationData, 'grantee' | 'grantedBy' | 'scopeOfAuthorization'>
): Promise<AdminAuthorizationData> {
  const iri = iriForContained(data, factory)
  const doc = withContext(dataModelContext, {
    ...adminAuthorization,
    id: iri,
    type: [INTEROP.AdminAuthorization],
  })
  await putJsonLd(iri, factory.fetch, doc, { 'If-None-Match': '*' })
  return { id: iri, type: [INTEROP.AdminAuthorization], ...adminAuthorization }
}

/** Delete an AdminAuthorization resource from the org's AuthorizationRegistry. */
export async function deleteAdminAuthorization(
  id: string,
  factory: AuthorizationAgentFactory
): Promise<void> {
  const response = await factory.fetch(id, { method: 'DELETE' })
  if (!response.ok) {
    throw new Error(`failed to delete admin authorization: ${response.status}`)
  }
}

export async function createAuthorizationRegistry(
  data: AuthorizationRegistryData,
  factory: AuthorizationAgentFactory
): Promise<void> {
  const dataset = new Store()
  dataset.add(
    DataFactory.quad(
      DataFactory.namedNode(data.id),
      RDF.terms.type,
      INTEROP.terms.AuthorizationRegistry
    )
  )
  await createContainer(data.id, factory, dataset)
}

export function iriForContained(
  data: AuthorizationRegistryData,
  factory: AuthorizationAgentFactory,
  container = false
): string {
  return containerIriForContained(data.id, factory, container)
}
