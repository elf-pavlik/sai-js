import { type JsonLdContext, type LanguageMap, SKOS } from '@janeirodigital/interop-utils'
import { dataModelContext } from './context'

export type AccessDescriptionId = {
  id: string
  type: string[]
}

export type AccessDescriptionData = AccessDescriptionId & {
  /** language map — the untagged label under `@none`, translations under their tags */
  label: LanguageMap
  /** language map — the untagged definition under `@none`, translations under their tags */
  definition?: LanguageMap
}

/**
 * The description models' shared context: the data-model context with
 * `label` AND `definition` as language maps (`@container: '@language'`,
 * JSON-LD 1.1 §4.6.2). `buildFrame` skips language-map terms, so framing
 * emits the maps as-is.
 */
export const accessDescriptionContext: JsonLdContext = {
  ...dataModelContext,
  label: { '@id': SKOS.prefLabel, '@container': '@language' },
  definition: { '@id': SKOS.definition, '@container': '@language' },
}
