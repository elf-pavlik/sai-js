import {
  type JsonLdContext,
  type LanguageMap,
  SKOS,
  frameNode,
  opt,
} from '@janeirodigital/interop-utils'
import { dataModelContext } from './context'

export type SocialAgentInvitationId = {
  id: string
  type: string[]
}

export type SocialAgentInvitationData = SocialAgentInvitationId & {
  capabilityUrl: string
  /** language map — the untagged label under `@none`, translations under their tags */
  label: LanguageMap
  note?: string
  registeredAgent?: string
}

/**
 * Per-model context: the shared context with `label` as a language map
 * (`@container: '@language'`, JSON-LD 1.1 §4.6.2) — tagged prefLabels compact
 * under their language tag, untagged under `@none`. `buildFrame` skips
 * language-map terms (their default frame entry would be parsed as the map
 * itself), so framing emits the map as-is.
 */
export const socialAgentInvitationContext: JsonLdContext = {
  ...dataModelContext,
  label: { '@id': SKOS.prefLabel, '@container': '@language' },
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
  const node = await frameNode(doc, socialAgentInvitationContext, id)
  return {
    id,
    type: node.type ?? [],
    capabilityUrl: node.capabilityUrl as string,
    label: (node.label as LanguageMap | undefined) ?? {},
    note: opt(node, 'note'),
    registeredAgent: opt(node, 'registeredAgent'),
  }
}
