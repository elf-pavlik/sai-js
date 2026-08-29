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
import type { GrantData } from '.'
import { loadGrant } from './grant'
import { agentRegistrationAcrTemplate } from './templates/AgentRegistration.acr'
import type { AgentAndClient } from './templates/types'

// ──────────────────────────
// Types
// ──────────────────────────

export type AgentRegistrationId = {
  id: string
  /** rdf:type IRIs — captured from framing on read (via the derived modules), written via compaction on write */
  type: string[]
}

export type AgentRegistrationData = AgentRegistrationId & {
  registeredAgent: string
  hasDataGrant?: string[]
}

// ──────────────────────────
// Write path: AgentRegistrationData → Dataset
// ──────────────────────────

export async function toDataset(data: AgentRegistrationData): Promise<Store> {
  const store = new Store()
  const node = DataFactory.namedNode(data.id)
  if (data.registeredAgent) {
    store.add(
      DataFactory.quad(
        node,
        INTEROP.terms.registeredAgent,
        DataFactory.namedNode(data.registeredAgent)
      )
    )
  }
  if (data.hasDataGrant) {
    for (const grantIri of data.hasDataGrant) {
      store.add(DataFactory.quad(node, INTEROP.terms.hasDataGrant, DataFactory.namedNode(grantIri)))
    }
  }
  return store
}

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

export async function getDataGrantIris(data: AgentRegistrationData): Promise<string[]> {
  return data.hasDataGrant ?? []
}

export async function getGranted(data: AgentRegistrationData): Promise<boolean> {
  return (await getDataGrantIris(data)).length > 0
}

export async function getDataGrants(
  data: AgentRegistrationData,
  fetch: WhatwgFetch
): Promise<GrantData[]> {
  const iris = await getDataGrantIris(data)
  return Promise.all(iris.map((iri) => loadGrant(iri, fetch)))
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
