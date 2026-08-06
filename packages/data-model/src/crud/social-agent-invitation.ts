import { type WhatwgFetch } from '@janeirodigital/interop-utils'
import { fetchJsonLd, frameDoc, putJsonLd, withContext } from '../jsonld-utils'

// ──────────────────────────
// JSON-LD context (only used by this module)
// ──────────────────────────

const invitationContext = {
  id: '@id',
  type: '@type',

  capabilityUrl: {
    '@id': 'http://www.w3.org/ns/solid/interop#hasCapabilityUrl',
    '@type': '@id',
  },
  prefLabel: { '@id': 'http://www.w3.org/2004/02/skos/core#prefLabel' },
  note: { '@id': 'http://www.w3.org/2004/02/skos/core#note' },
  registeredAgent: {
    '@id': 'http://www.w3.org/ns/solid/interop#registeredAgent',
    '@type': '@id',
  },
}

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
 * Uses jsonld.frame with the invitation context: node references
 * (`capabilityUrl`, `registeredAgent`) are coerced to strings via
 * `@type: '@id'`, literals to plain strings, and the rdf:type (from framing)
 * to a string array.
 */
export async function fromJsonLd(
  doc: unknown,
  iri: string
): Promise<SocialAgentInvitationData> {
  const node = (await frameDoc(doc, invitationContext, iri)) as any
  return {
    id: iri,
    type: node.type ? (Array.isArray(node.type) ? node.type : [node.type]) : [],
    capabilityUrl: node.capabilityUrl ?? '',
    prefLabel: node.prefLabel ?? '',
    // framing emits `null` for framed-but-absent properties — normalize to undefined
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
  await putJsonLd(data.id, fetch, withContext(invitationContext, data))
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
