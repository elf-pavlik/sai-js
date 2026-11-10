import { type DataRegistrationData, dataModelContext } from '@janeirodigital/interop-data-model'
import {
  type WhatwgFetch,
  createContainer,
  postMember,
  withContext,
} from '@janeirodigital/interop-utils'

// ──────────────────────────
// Write path: DataRegistrationData → container (container.create)
// ──────────────────────────

export async function createDataRegistration(
  data: DataRegistrationData,
  fetch: WhatwgFetch
): Promise<void> {
  const doc = withContext(dataModelContext, data)
  if (data.partOf) {
    // Flat LWS storage: the registration is a pre-minted container member of
    // the data registry. POST + the id's UUID as Slug creates it there (the
    // store records `lws:contains` / `lws:partOf`) and patches its description.
    await postMember(data.partOf, fetch, { id: data.id, body: doc }, { container: true })
    return
  }
  // Hierarchical/bootstrap storage: PUT the container and patch its
  // description resource with `INSERT DATA`.
  await createContainer(data.id, fetch, doc)
}
