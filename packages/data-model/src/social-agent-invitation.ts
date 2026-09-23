import { frameNode, opt } from '@janeirodigital/interop-utils'
import { dataModelContext } from './context'

// ──────────────────────────
// Types
// ──────────────────────────

/** Identity of a social agent invitation. */
export type SocialAgentInvitationId = {
  id: string
  /** rdf:type IRIs — captured from framing on read, written via compaction on write */
  type: string[]
}

export type SocialAgentInvitationData = SocialAgentInvitationId & {
  capabilityUrl: string
  label: string
  note?: string
  registeredAgent?: string
}

// ──────────────────────────
// Read path: JSON-LD → SocialAgentInvitationData
// ──────────────────────────

const SOCIAL_AGENT_INVITATION_TERMS = ['capabilityUrl', 'label', 'note', 'registeredAgent']

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
export async function fromJsonLd(doc: unknown, id: string): Promise<SocialAgentInvitationData> {
  const node = await frameNode(doc, dataModelContext, id)
  return {
    id,
    type: node.type ?? [],
    capabilityUrl: node.capabilityUrl as string,
    label: opt(node, 'label'),
    note: opt(node, 'note'),
    registeredAgent: opt(node, 'registeredAgent'),
  }
}
