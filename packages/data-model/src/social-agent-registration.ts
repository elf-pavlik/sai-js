import { SKOS, frameNode, loader, opt, str, strs } from '@janeirodigital/interop-utils'
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
  label: string
  note?: string
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
 * (`registeredAgent`, `reciprocalRegistration`) are
 * coerced to strings via `@type: '@id'`, `hasDataGrant` to a string array via
 * `@type: '@id'` + `@container: '@set'`, literals to plain strings, and the
 * rdf:type (from framing) to a string array.
 */
export async function fromJsonLd(doc: unknown, id: string): Promise<SocialAgentRegistrationData> {
  const node = await frameNode(doc, dataModelContext, id)
  return {
    id,
    type: node.type ?? [],
    registeredAgent: str(node, 'registeredAgent'),
    hasDataGrant: strs(node, 'hasDataGrant'),
    hasAdminGrant: strs(node, 'hasAdminGrant'),
    label: str(node, 'label'),
    note: opt(node, 'note'),
    reciprocalRegistration: opt(node, 'reciprocalRegistration'),
  }
}

export const loadSocialAgentRegistration = loader(fromJsonLd)

// ──────────────────────────
// Write path: SocialAgentRegistrationData → Dataset
// ──────────────────────────

export function toDataset(data: SocialAgentRegistrationData): Store {
  const store = registrationToDataset(data)
  const node = DataFactory.namedNode(data.id)
  store.add(DataFactory.quad(node, SKOS.terms.prefLabel, DataFactory.literal(data.label)))
  if (data.note) {
    store.add(DataFactory.quad(node, SKOS.terms.note, DataFactory.literal(data.note)))
  }
  return store
}

// ──────────────────────────
// Accessors
// ──────────────────────────

/** The registration's AdminGrant IRIs (interop:hasAdminGrant). */
export function getAdminGrantIris(data: SocialAgentRegistrationData): string[] {
  return data.hasAdminGrant ?? []
}
