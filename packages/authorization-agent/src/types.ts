import type { WhatwgFetch } from '@janeirodigital/interop-utils'

/**
 * Plain dependencies for data-model functions (replaces the factories):
 * functions that read/write pass `fetch`; writers that assign new resource
 * IRIs (via `iriForContained`) pass the full `DataModelDependencies`.
 * Moved here from the data-model package — nothing in data-model consumes it.
 */
export interface DataModelDependencies {
  fetch: WhatwgFetch
  randomUUID(): string
}