import {
  type ApplicationRegistrationData,
  dataModelContext,
} from '@janeirodigital/interop-data-model'
import {
  type WhatwgFetch,
  createContainer,
  toStore,
  withContext,
} from '@janeirodigital/interop-utils'

// ──────────────────────────
// Write path: ApplicationRegistrationData → container (container.create)
// ──────────────────────────

export async function createApplicationRegistration(
  data: ApplicationRegistrationData,
  fetch: WhatwgFetch
): Promise<void> {
  // build the dataset via jsonld.toRDF (withContext + toStore) — the rdf:type
  // quad comes from `data.type` (captured from framing on read), no hand-built
  // DataFactory quads; only the container.create hand-off stays N3-based
  const dataset = await toStore(withContext(dataModelContext, data))
  await createContainer(data.id, fetch, dataset)
}
