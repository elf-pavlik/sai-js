import {
  type WhatwgFetch,
  fetchJsonLd,
  frameDoc,
  putJsonLd,
  withContext,
} from '@janeirodigital/interop-utils'
import { dataModelContext } from '../context'

// ──────────────────────────
// Types
// ──────────────────────────

export type SocialAgentInvitationData = {
  id: string
  /** rdf:type IRIs — captured from framing on read, written via compaction on write */
  type: string[]
  capabilityUrl: string
  prefLabel: string
  note?: string
  registeredAgent?: string
}

// ──────────────────────────
// Read path: JSON-LD → SocialAgentInvitationData
// ──────────────────────────

/**
 * Convert a JSON-LD document (fetched as application/ld+json) directly into a
 * SocialAgentInvitationData POJO.
 *
 * The document can be in expanded, compacted, or flattened form.
 * Uses jsonld.frame with the shared data model context: node references
 * (`capabilityUrl`, `registeredAgent`) are coerced to strings via
 * `@type: '@id'`, literals to plain strings, and the rdf:type (from framing)
 * to a string array.
 */
export async function fromJsonLd(doc: unknown, iri: string): Promise<SocialAgentInvitationData> {
  const node = (await frameDoc(doc, dataModelContext, iri)) as any
  return {
    id: iri,
    type: node.type ? (Array.isArray(node.type) ? node.type : [node.type]) : [],
    capabilityUrl: node.capabilityUrl ?? '',
    prefLabel: node.prefLabel ?? '',
    // @omitDefault omits framed-but-absent properties — normalize to undefined anyway
    note: node.note ?? undefined,
    registeredAgent: node.registeredAgent ?? undefined,
  }
}

export async function loadSocialAgentInvitation(
  iri: string,
  fetch: WhatwgFetch
): Promise<SocialAgentInvitationData> {
  return fromJsonLd(await fetchJsonLd(iri, fetch), iri)
}

// ──────────────────────────
// Write path: SocialAgentInvitationData → JSON-LD (PUT)
// ──────────────────────────

export async function putSocialAgentInvitation(
  data: SocialAgentInvitationData,
  fetch: WhatwgFetch
): Promise<void> {
  await putJsonLd(data.id, fetch, withContext(dataModelContext, data))
}

// ──────────────────────────
// Behavior functions (replacing class methods)
// ──────────────────────────

export async function setRegisteredAgent(
  data: SocialAgentInvitationData,
  fetch: WhatwgFetch,
  webId: string
): Promise<void> {
  data.registeredAgent = webId
  await putSocialAgentInvitation(data, fetch)
}
