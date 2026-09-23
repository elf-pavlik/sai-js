import {
  type JsonLdContext,
  type LanguageMap,
  SKOS,
  frameNode,
  selectNode,
} from '@janeirodigital/interop-utils'
import { dataModelContext } from './context'

export type RoleId = {
  id: string
  type: string[]
}

export type RoleData = RoleId & {
  /** language map — the untagged label under `@none`, translations under their tags */
  label: LanguageMap
  members: string[]
}

/**
 * Per-model context: the shared context with `label` as a language map
 * (`@container: '@language'`, JSON-LD 1.1 §4.6.2) — tagged prefLabels compact
 * under their language tag, untagged under `@none`. `buildFrame` skips
 * language-map terms (their default frame entry would be parsed as the map
 * itself), so framing emits the map as-is. Other models still read `label` as
 * a scalar until they opt in model by model.
 */
export const roleContext: JsonLdContext = {
  ...dataModelContext,
  label: { '@id': SKOS.prefLabel, '@container': '@language' },
}

const ROLE_TERMS = ['label', 'members'] as const

export async function fromJsonLd(doc: unknown, id: string): Promise<RoleData> {
  return selectNode(await frameNode(doc, roleContext, id), ROLE_TERMS) as unknown as RoleData
}
