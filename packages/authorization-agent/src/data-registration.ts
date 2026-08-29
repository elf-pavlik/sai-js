import { type DataRegistrationData, dataModelContext } from '@janeirodigital/interop-data-model'
import {
  type WhatwgFetch,
  createContainer,
  toStore,
  withContext,
} from '@janeirodigital/interop-utils'

// ──────────────────────────
// Write path: DataRegistrationData → container (container.create)
// ──────────────────────────

export async function createDataRegistration(
  data: DataRegistrationData,
  fetch: WhatwgFetch
): Promise<void> {
  // build the dataset via jsonld.toRDF (withContext + toStore) — the rdf:type
  // quads come from data.type (no hand-built DataFactory quads); only the
  // container.create hand-off (PUT empty container + SPARQL patch of the
  // description resource) stays N3-based in the container module
  const dataset = await toStore(withContext(dataModelContext, data), data.id)
  await createContainer(data.id, fetch, dataset)
}
