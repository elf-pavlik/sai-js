import {
  type WhatwgFetch,
  fetchJsonLd,
  frameDoc,
  toStore,
  withContext,
} from '@janeirodigital/interop-utils'
import type { ApplicationFactory, AuthorizationAgentFactory, GrantData } from '.'
import { dataModelContext } from './context'
import { createContainer } from './crud/container'
import type { AgentAndClient } from './templates/types'

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
export type ApplicationRegistrationData = {
  id: string
  /** rdf:type IRIs — captured from framing on read, written on create */
  type: string[]
  registeredAgent: string
  hasDataGrant: string[]
  /** Derived: whether the registration has any data grants. */
  granted: boolean
}

// ──────────────────────────
// Read path: JSON-LD → ApplicationRegistrationData
// ──────────────────────────

/**
 * Convert a JSON-LD document (fetched as application/ld+json) directly into an
 * ApplicationRegistrationData POJO. The document can be in expanded, compacted,
 * or flattened form.
 */
export async function fromJsonLd(doc: unknown, iri: string): Promise<ApplicationRegistrationData> {
  const node = (await frameDoc(doc, dataModelContext, iri)) as any
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
  iri: string,
  fetch: WhatwgFetch
): Promise<ApplicationRegistrationData> {
  return fromJsonLd(await fetchJsonLd(iri, fetch), iri)
}

// ──────────────────────────
// Write path: ApplicationRegistrationData → container (container.create)
// ──────────────────────────

export async function createApplicationRegistration(
  data: ApplicationRegistrationData,
  factory: AuthorizationAgentFactory,
  creator: AgentAndClient
): Promise<void> {
  // build the dataset via jsonld.toRDF (withContext + toStore) — the rdf:type
  // quad comes from `data.type` (captured from framing on read), no hand-built
  // DataFactory quads; only the container.create hand-off stays N3-based
  const dataset = await toStore(withContext(dataModelContext, data))
  await createContainer(data.id, factory, creator, dataset)
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
  factory: ApplicationFactory
): Promise<GrantData[]> {
  return Promise.all(data.hasDataGrant.map((iri) => factory.dataGrant(iri)))
}
