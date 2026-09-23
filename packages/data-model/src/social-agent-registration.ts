import {
  type JsonLdContext,
  type LanguageMap,
  SKOS,
  frameNode,
  opt,
} from '@janeirodigital/interop-utils'
import { DataFactory, type Store } from 'n3'
import { type AgentRegistrationId, toDataset as registrationToDataset } from './agent-registration'
import { dataModelContext } from './context'

export type SocialAgentRegistrationId = AgentRegistrationId

export type SocialAgentRegistrationData = SocialAgentRegistrationId & {
  registeredAgent: string
  hasDataGrant?: string[]
  hasAdminGrant?: string[]
  /** language map — the untagged label under `@none`, translations under their tags */
  label: LanguageMap
  note?: string
  reciprocalRegistration?: string
}

export type SocialAgentId = {
  id: string
  type: string[]
}

/**
 * Per-model context: the shared context with `label` as a language map
 * (`@container: '@language'`, JSON-LD 1.1 §4.6.2) — tagged prefLabels compact
 * under their language tag, untagged under `@none`. `buildFrame` skips
 * language-map terms (their default frame entry would be parsed as the map
 * itself), so framing emits the map as-is.
 */
export const socialAgentRegistrationContext: JsonLdContext = {
  ...dataModelContext,
  label: { '@id': SKOS.prefLabel, '@container': '@language' },
}

// ──────────────────────────
// Read path: JSON-LD → SocialAgentRegistrationData
// ──────────────────────────

const SOCIAL_AGENT_REGISTRATION_TERMS = [
  'registeredAgent',
  'hasDataGrant',
  'hasAdminGrant',
  'label',
  'note',
  'reciprocalRegistration',
]

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
  const node = await frameNode(doc, socialAgentRegistrationContext, id)
  return {
    id,
    type: node.type ?? [],
    registeredAgent: node.registeredAgent as string,
    hasDataGrant: node.hasDataGrant as string[],
    hasAdminGrant: node.hasAdminGrant as string[],
    label: (node.label as LanguageMap | undefined) ?? {},
    note: opt(node, 'note'),
    reciprocalRegistration: opt(node, 'reciprocalRegistration'),
  }
}

export function toDataset(data: SocialAgentRegistrationData): Store {
  const store = registrationToDataset(data)
  const node = DataFactory.namedNode(data.id)
  for (const [lang, value] of Object.entries(data.label)) {
    store.add(
      DataFactory.quad(
        node,
        SKOS.terms.prefLabel,
        // the untagged entry (`@none`) is a plain literal, the rest carry
        // their language tag
        lang === '@none' ? DataFactory.literal(value) : DataFactory.literal(value, lang)
      )
    )
  }
  if (data.note) {
    store.add(DataFactory.quad(node, SKOS.terms.note, DataFactory.literal(data.note)))
  }
  return store
}

export function getAdminGrantIris(data: SocialAgentRegistrationData): string[] {
  return data.hasAdminGrant ?? []
}
