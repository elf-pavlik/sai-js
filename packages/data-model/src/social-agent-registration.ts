import {
  INTEROP,
  SKOS,
  type WhatwgFetch,
  fetchJsonLd,
  frameDoc,
} from '@janeirodigital/interop-utils'
import { DataFactory, type Store } from 'n3'
import { type AgentRegistrationId, toDataset as registrationToDataset } from './agent-registration'
import { dataModelContext } from './context'

// ──────────────────────────
// Types
// ──────────────────────────

export type SocialAgentRegistrationId = AgentRegistrationId

export type SocialAgentRegistrationData = SocialAgentRegistrationId & {
  registeredAgent: string
  hasDataGrant?: string[]
  /** AdminGrant IRIs (R1 admin marker) — captured from framing on read */
  hasAdminGrant?: string[]
  prefLabel: string
  note?: string
  hasAccessNeedGroup?: string
  /** IRI of the peer's reciprocal registration — loaded lazily, see the AA `loadReciprocalRegistration` */
  reciprocalRegistration?: string
}

/** Identity of a social agent (boundary-facing; produced by the agent registries). */
export type SocialAgentId = {
  id: string
  /** rdf:type IRIs — always `[INTEROP.SocialAgent]` when produced by the registries */
  type: string[]
}

// ──────────────────────────
// Read path: JSON-LD → SocialAgentRegistrationData
// ──────────────────────────

/**
 * Convert a JSON-LD document (fetched as application/ld+json) directly into a
 * SocialAgentRegistrationData POJO.
 *
 * The document can be in expanded, compacted, or flattened form. Uses
 * jsonld.frame with the shared data model context: node references
 * (`registeredAgent`, `hasAccessNeedGroup`, `reciprocalRegistration`) are
 * coerced to strings via `@type: '@id'`, `hasDataGrant` to a string array via
 * `@type: '@id'` + `@container: '@set'`, literals to plain strings, and the
 * rdf:type (from framing) to a string array.
 */
export async function fromJsonLd(doc: unknown, id: string): Promise<SocialAgentRegistrationData> {
  const node = (await frameDoc(doc, dataModelContext, id)) as any
  return {
    id: id,
    type: node.type ? (Array.isArray(node.type) ? node.type : [node.type]) : [],
    registeredAgent: node.registeredAgent,
    hasDataGrant: node.hasDataGrant ?? [],
    hasAdminGrant: node.hasAdminGrant ?? [],
    prefLabel: node.prefLabel ?? '',
    // @omitDefault omits framed-but-absent properties — normalize to undefined anyway
    note: node.note ?? undefined,
    hasAccessNeedGroup: node.hasAccessNeedGroup ?? undefined,
    reciprocalRegistration: node.reciprocalRegistration ?? undefined,
  }
}

export async function loadSocialAgentRegistration(
  id: string,
  fetch: WhatwgFetch
): Promise<SocialAgentRegistrationData> {
  return fromJsonLd(await fetchJsonLd(id, fetch), id)
}

// ──────────────────────────
// Write path: SocialAgentRegistrationData → Dataset
// ──────────────────────────

export async function toDataset(data: SocialAgentRegistrationData): Promise<Store> {
  const store = await registrationToDataset(data)
  const node = DataFactory.namedNode(data.id)
  store.add(DataFactory.quad(node, SKOS.terms.prefLabel, DataFactory.literal(data.prefLabel)))
  if (data.note) {
    store.add(DataFactory.quad(node, SKOS.terms.note, DataFactory.literal(data.note)))
  }
  if (data.hasAccessNeedGroup) {
    store.add(
      DataFactory.quad(
        node,
        INTEROP.terms.hasAccessNeedGroup,
        DataFactory.namedNode(data.hasAccessNeedGroup)
      )
    )
  }
  return store
}

// ──────────────────────────
// Accessors
// ──────────────────────────

/** The registration's AdminGrant IRIs (interop:hasAdminGrant). */
export async function getAdminGrantIris(data: SocialAgentRegistrationData): Promise<string[]> {
  return data.hasAdminGrant ?? []
}
