import type {
  ConvertingStoreEntry,
  RepresentationConverter,
  RepresentationConvertingStore,
  RepresentationPreferences,
} from '@solid/community-server'
import { INTERNAL_QUADS, PreferenceSupport } from '@solid/community-server'

const preferences: RepresentationPreferences = { type: { [INTERNAL_QUADS]: 1 } }

export class SparqlStoreEntry implements ConvertingStoreEntry {
  readonly supportChecker: PreferenceSupport
  constructor(
    readonly store: RepresentationConvertingStore,
    converter: RepresentationConverter
  ) {
    this.supportChecker = new PreferenceSupport(preferences, converter)
  }
}
