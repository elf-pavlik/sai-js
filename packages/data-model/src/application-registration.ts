import {
  type WhatwgFetch,
  fetchJsonLd,
  frameDoc,
  toStore,
  withContext,
} from '@janeirodigital/interop-utils'
import type { GrantData } from '.'
import { dataModelContext } from './context'
import { createContainer } from './crud/container'
import { loadGrant } from './grant'

// ──────────────────────────
// Types
// ──────────────────────────

/**
 * Plain JSON representation of an application registration.
 *
 * Design B: single-node resource — the denormalized client-ID-document fields
 * (name/logo/accessNeedGroup/hasAuthorizationCallbackEndpoint) are not part of
 * the data model; consumers read them via `factory.clientIdDocument(registeredAgent)`.
 */
export type ApplicationRegistrationId = {
  id: string
  /** rdf:type IRIs — captured from framing on read, written on create */
  type: string[]
}

export type ApplicationRegistrationData = ApplicationRegistrationId & {
  registeredAgent: string
  hasDataGrant: string[]
  /** Derived: whether the registration has any data grants. */
  granted: boolean
}

/** Identity of an application (boundary-facing; produced by the agent registries). */
export type ApplicationId = {
  id: string
  /** rdf:type IRIs — always `[INTEROP.Application]` when produced by the registries */
  type: string[]
}

// ──────────────────────────
// Read path: JSON-LD → ApplicationRegistrationData
// ──────────────────────────

/**
 * Convert a JSON-LD document (fetched as application/ld+json) directly into an
 * ApplicationRegistrationData POJO. The document can be in expanded, compacted,
 * or flattened form.
 */
export async function fromJsonLd(doc: unknown, id: string): Promise<ApplicationRegistrationData> {
  const node = (await frameDoc(doc, dataModelContext, id)) as any
  const hasDataGrant = node.hasDataGrant ?? []
  return {
    id: node.id ?? node['@id'],
    type: node.type ? (Array.isArray(node.type) ? node.type : [node.type]) : [],
    registeredAgent: node.registeredAgent,
    hasDataGrant,
    granted: hasDataGrant.length > 0,
  }
}

export async function loadApplicationRegistration(
  id: string,
  fetch: WhatwgFetch
): Promise<ApplicationRegistrationData> {
  return fromJsonLd(await fetchJsonLd(id, fetch), id)
}

// ──────────────────────────
// Write path: ApplicationRegistrationData → container (container.create)
// ──────────────────────────

export async function createApplicationRegistration(
  data: ApplicationRegistrationData,
  fetch: WhatwgFetch
): Promise<void> {
  // build the dataset via jsonld.toRDF (withContext + toStore) — the rdf:type
  // quad comes from `data.type` (captured from framing on read), no hand-built
  // DataFactory quads; only the container.create hand-off stays N3-based
  const dataset = await toStore(withContext(dataModelContext, data))
  await createContainer(data.id, fetch, dataset)
}

// ──────────────────────────
// Behavior functions
// ──────────────────────────

/** Whether the registration has any data grants. */
export function getGranted(data: ApplicationRegistrationData): boolean {
  return data.hasDataGrant.length > 0
}

/** Fetch all data grants of this application registration. */
export async function getDataGrants(
  data: ApplicationRegistrationData,
  fetch: WhatwgFetch
): Promise<GrantData[]> {
  return Promise.all(data.hasDataGrant.map((iri) => loadGrant(iri, fetch)))
}
