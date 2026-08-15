import {
  INTEROP,
  RDF,
  deletePatch,
  fetchJsonLd,
  frameDoc,
  insertPatch,
  putJsonLd,
  withContext,
} from '@janeirodigital/interop-utils'
import { DataFactory, Store } from 'n3'
import type { AuthorizationAgentFactory } from '..'
import { dataModelContext, linkedIrisJsonLd } from '../context'
import {
  applyPatch,
  iriForContained as containerIriForContained,
  createContainer,
} from './container'

// ──────────────────────────
// Types
// ──────────────────────────

export type ActivityRegistryData = {
  id: string
}

/**
 * An activity resource in the Activity Registry (the outbox): producers PUT
 * one per change that needs a follow-up workflow; the main agent's webhook
 * handler reads `activityType` + `payload` and starts the corresponding
 * workflow. `payload` is the ready-made workflow input (JSON).
 */
export type ActivityData = {
  id: string
  activityType: string
  /** IRI of the changed record (or container) that triggered the activity */
  target: string
  /** ready-made workflow input the producer builds at write time */
  payload: unknown
  /** 'pending' until the consumer processes it, then 'done' (or removed) */
  status: string
  createdAt: string
}

// ──────────────────────────
// Behavior functions
// ──────────────────────────

export async function createActivityRegistry(
  data: ActivityRegistryData,
  factory: AuthorizationAgentFactory
): Promise<void> {
  const dataset = new Store()
  dataset.add(
    DataFactory.quad(DataFactory.namedNode(data.id), RDF.terms.type, INTEROP.terms.ActivityRegistry)
  )
  await createContainer(data.id, factory, dataset)
}

export function iriForContained(
  data: ActivityRegistryData,
  factory: AuthorizationAgentFactory,
  container = false
): string {
  return containerIriForContained(data.id, factory, container)
}

/** The activity resources currently in the registry (ldp:contains). */
export async function getActivityIris(
  data: ActivityRegistryData,
  factory: AuthorizationAgentFactory
): Promise<string[]> {
  return linkedIrisJsonLd(data.id, factory.fetch, 'contains')
}

/**
 * PUT a new activity resource into the Activity Registry — same pattern as
 * grants and data authorizations: `iriForContained` + PUT with
 * `If-None-Match: *` (expanded JSON-LD). The `payload` is stored as a JSON
 * string literal.
 */
export async function createActivity(
  data: ActivityRegistryData,
  factory: AuthorizationAgentFactory,
  activity: Omit<ActivityData, 'id'>
): Promise<ActivityData> {
  const iri = iriForContained(data, factory)
  const doc = withContext(dataModelContext, {
    ...activity,
    id: iri,
    type: [INTEROP.Activity],
    payload: JSON.stringify(activity.payload),
  })
  await putJsonLd(iri, factory.fetch, doc, { 'If-None-Match': '*' })
  return { ...activity, id: iri }
}

/** Read an activity resource from the Activity Registry. */
export async function loadActivity(
  iri: string,
  factory: AuthorizationAgentFactory
): Promise<ActivityData> {
  const node = (await frameDoc(await fetchJsonLd(iri, factory.fetch), dataModelContext, iri)) as any
  return {
    id: iri,
    activityType: node.activityType,
    target: node.target,
    payload: node.payload ? JSON.parse(node.payload) : undefined,
    status: node.status,
    createdAt: node.createdAt,
  }
}

/**
 * Set the status of an activity resource (single SPARQL PATCH replacing the
 * current status literal). Used by the per-target consumer to mark processed
 * entries 'done'.
 */
export async function updateActivityStatus(
  iri: string,
  factory: AuthorizationAgentFactory,
  status: string
): Promise<void> {
  const current = await loadActivity(iri, factory)
  const node = DataFactory.namedNode(iri)
  const sparqlUpdate = [
    await deletePatch(
      new Store([
        DataFactory.quad(node, INTEROP.terms.status, DataFactory.literal(current.status)),
      ])
    ),
    await insertPatch(
      new Store([DataFactory.quad(node, INTEROP.terms.status, DataFactory.literal(status))])
    ),
  ].join(';')
  // patch the activity resource directly (it is its own description resource)
  await applyPatch(iri, factory, sparqlUpdate, iri)
}
