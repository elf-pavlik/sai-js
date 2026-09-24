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
