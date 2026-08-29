import { type WhatwgFetch, fetchJsonLd, frameDoc } from '@janeirodigital/interop-utils'
import { dataModelContext } from './context'

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
