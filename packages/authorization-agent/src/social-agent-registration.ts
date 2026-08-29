import {
  type SocialAgentRegistrationData,
  getAdminGrantIris,
  loadSocialAgentRegistration,
  toDataset,
} from '@janeirodigital/interop-data-model'
import {
  INTEROP,
  RDF,
  type WhatwgFetch,
  addStatement,
  applyPatch,
  createContainer,
  deletePatch,
  insertPatch,
  replaceStatement,
} from '@janeirodigital/interop-utils'
import { DataFactory, Store } from 'n3'

/**
 * Lazily load the peer's reciprocal registration — only consumers that need its
 * data (`hasAccessNeedGroup`, data grants) call this. The leaf read
 * (`loadSocialAgentRegistration`) no longer recurses into the reciprocal.
 */
export async function loadReciprocalRegistration(
  data: SocialAgentRegistrationData,
  fetch: WhatwgFetch
): Promise<SocialAgentRegistrationData | undefined> {
  if (!data.reciprocalRegistration) return undefined
  return loadSocialAgentRegistration(data.reciprocalRegistration, fetch)
}

export async function createSocialAgentRegistration(
  data: SocialAgentRegistrationData,
  fetch: WhatwgFetch
): Promise<void> {
  const dataset = toDataset(data)
  dataset.add(
    DataFactory.quad(
      DataFactory.namedNode(data.id),
      RDF.terms.type,
      INTEROP.terms.SocialAgentRegistration
    )
  )
  await createContainer(data.id, fetch, dataset)
}

export async function setAccessNeedGroup(
  data: SocialAgentRegistrationData,
  fetch: WhatwgFetch,
  accessNeedGroupIri: string
): Promise<void> {
  const node = DataFactory.namedNode(data.id)
  const quad = DataFactory.quad(
    node,
    INTEROP.terms.hasAccessNeedGroup,
    DataFactory.namedNode(accessNeedGroupIri)
  )
  if (data.hasAccessNeedGroup) {
    const priorQuad = DataFactory.quad(
      node,
      INTEROP.terms.hasAccessNeedGroup,
      DataFactory.namedNode(data.hasAccessNeedGroup)
    )
    await replaceStatement(data.id, fetch, priorQuad, quad)
  } else {
    await addStatement(data.id, fetch, quad)
  }
  data.hasAccessNeedGroup = accessNeedGroupIri
}

/**
 * Replace the registration's `hasAdminGrant` links to exactly `grantIris` in a
 * single PATCH (remove old + insert new) — exactly one Update notification on
 * the registration. `grantIris: []` unlinks (admin revoked). No-op when the
 * links already match (idempotent against re-delivery).
 */
export async function replaceAdminGrantLinks(
  data: SocialAgentRegistrationData,
  fetch: WhatwgFetch,
  grantIris: string[]
): Promise<void> {
  const current = getAdminGrantIris(data)
  const currentSet = new Set(current)
  const targetSet = new Set(grantIris)
  const removed = currentSet.difference(targetSet)
  const added = targetSet.difference(currentSet)
  if (removed.size === 0 && added.size === 0) return

  const node = DataFactory.namedNode(data.id)
  const removeQuads = [...removed].map((iri) =>
    DataFactory.quad(node, INTEROP.terms.hasAdminGrant, DataFactory.namedNode(iri))
  )
  const insertQuads = [...added].map((iri) =>
    DataFactory.quad(node, INTEROP.terms.hasAdminGrant, DataFactory.namedNode(iri))
  )
  const sparqlUpdate = [
    ...(removed.size ? [await deletePatch(new Store(removeQuads))] : []),
    ...(added.size ? [await insertPatch(new Store(insertQuads))] : []),
  ].join(';')
  await applyPatch(data.id, fetch, sparqlUpdate)
  data.hasAdminGrant = [...grantIris]
}
