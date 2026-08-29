import {
  type AgentRegistrationData,
  agentRegistrationAcrTemplate,
  getDataGrantIris,
} from '@janeirodigital/interop-data-model'
import type { AgentAndClient } from '@janeirodigital/interop-data-model'
import {
  INTEROP,
  type WhatwgFetch,
  addStatement,
  applyPatch,
  deletePatch,
  discoverAccessResource,
  insertPatch,
  parseTurtle,
  removeStatement,
  serializeTurtle,
} from '@janeirodigital/interop-utils'
import { DataFactory, Store } from 'n3'

// ──────────────────────────
// Behavior functions (replacing class methods)
// ──────────────────────────

export async function setAcr(
  data: AgentRegistrationData,
  fetch: WhatwgFetch,
  creator: AgentAndClient,
  peer: AgentAndClient
): Promise<void> {
  const acrLocation = await discoverAccessResource(data.id, fetch)
  const dataset = await parseTurtle(
    agentRegistrationAcrTemplate({
      id: data.id,
      owner: creator,
      peer,
    })
  )
  const response = await fetch(acrLocation, {
    method: 'PUT',
    body: await serializeTurtle(dataset),
    headers: { 'Content-Type': 'text/turtle' },
  })
  if (!response.ok) throw new Error(await response.text())
}

export async function addDataGrant(
  data: AgentRegistrationData,
  fetch: WhatwgFetch,
  grantIri: string
): Promise<void> {
  const quad = DataFactory.quad(
    DataFactory.namedNode(data.id),
    INTEROP.terms.hasDataGrant,
    DataFactory.namedNode(grantIri)
  )
  await addStatement(data.id, fetch, quad)
  data.hasDataGrant = [...(data.hasDataGrant ?? []), grantIri]
}

export async function removeDataGrant(
  data: AgentRegistrationData,
  fetch: WhatwgFetch,
  grantIri: string
): Promise<void> {
  const quad = DataFactory.quad(
    DataFactory.namedNode(data.id),
    INTEROP.terms.hasDataGrant,
    DataFactory.namedNode(grantIri)
  )
  await removeStatement(data.id, fetch, quad)
  data.hasDataGrant = (data.hasDataGrant ?? []).filter((iri) => iri !== grantIri)
}

export async function removeAllDataGrants(
  data: AgentRegistrationData,
  fetch: WhatwgFetch
): Promise<void> {
  const iris = await getDataGrantIris(data)
  await Promise.all(iris.map((iri) => removeDataGrant(data, fetch, iri)))
}

/**
 * Replace the registration's hasDataGrant links in a single PATCH: removes
 * the links to grants no longer in the set and adds the new ones, so the
 * registration emits exactly one Update notification. `grantIris` is the FULL
 * new set (may be []). No-op (no PATCH) when the set is unchanged.
 */
export async function replaceDataGrants(
  data: AgentRegistrationData,
  fetch: WhatwgFetch,
  grantIris: string[]
): Promise<void> {
  const current = await getDataGrantIris(data)
  const currentSet = new Set(current)
  const targetSet = new Set(grantIris)
  const removed = currentSet.difference(targetSet)
  const added = targetSet.difference(currentSet)
  if (removed.size === 0 && added.size === 0) return

  const node = DataFactory.namedNode(data.id)
  const removeQuads = [...removed].map((iri) =>
    DataFactory.quad(node, INTEROP.terms.hasDataGrant, DataFactory.namedNode(iri))
  )
  const insertQuads = [...added].map((iri) =>
    DataFactory.quad(node, INTEROP.terms.hasDataGrant, DataFactory.namedNode(iri))
  )
  const sparqlUpdate = [
    ...(removed.size ? [await deletePatch(new Store(removeQuads))] : []),
    ...(added.size ? [await insertPatch(new Store(insertQuads))] : []),
  ].join(';')
  await applyPatch(data.id, fetch, sparqlUpdate)
  data.hasDataGrant = [...grantIris]
}
