import {
  INTEROP,
  RDF,
  type WhatwgFetch,
  fetchJsonLd,
  frameDoc,
  putJsonLd,
  withContext,
} from '@janeirodigital/interop-utils'
import { DataFactory, Store } from 'n3'
import type { DataModelDependencies } from '..'
import { dataModelContext, linkedIrisJsonLd } from '../context'
import { iriForContained as containerIriForContained, createContainer } from './container'

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
  createdAt: string
}

// ──────────────────────────
// Behavior functions
// ──────────────────────────

export async function createActivityRegistry(
  data: ActivityRegistryData,
  fetch: WhatwgFetch
): Promise<void> {
  const dataset = new Store()
  dataset.add(
    DataFactory.quad(DataFactory.namedNode(data.id), RDF.terms.type, INTEROP.terms.ActivityRegistry)
  )
  await createContainer(data.id, fetch, dataset)
}

export function iriForContained(
  data: ActivityRegistryData,
  randomUUID: () => string,
  container = false
): string {
  return containerIriForContained(data.id, randomUUID, container)
}

/** The activity resources currently in the registry (ldp:contains). */
export async function getActivityIris(
  data: ActivityRegistryData,
  fetch: WhatwgFetch
): Promise<string[]> {
  return linkedIrisJsonLd(data.id, fetch, 'contains')
}

/**
 * PUT a new activity resource into the Activity Registry — same pattern as
 * grants and data authorizations: `iriForContained` + PUT with
 * `If-None-Match: *` (expanded JSON-LD). The `payload` is stored as a JSON
 * string literal.
 */
export async function createActivity(
  data: ActivityRegistryData,
  deps: DataModelDependencies,
  activity: Omit<ActivityData, 'id'>
): Promise<ActivityData> {
  const iri = iriForContained(data, deps.randomUUID)
  const doc = withContext(dataModelContext, {
    ...activity,
    id: iri,
    type: [INTEROP.Activity],
    payload: JSON.stringify(activity.payload),
  })
  await putJsonLd(iri, deps.fetch, doc, { 'If-None-Match': '*' })
  return { ...activity, id: iri }
}

/** Read an activity resource from the Activity Registry. */
export async function loadActivity(id: string, fetch: WhatwgFetch): Promise<ActivityData> {
  const node = (await frameDoc(await fetchJsonLd(id, fetch), dataModelContext, id)) as any
  return {
    id: id,
    activityType: node.activityType,
    target: node.target,
    payload: node.payload ? JSON.parse(node.payload) : undefined,
    createdAt: node.createdAt,
  }
}

/**
 * Record the completion of an activity: PUT a minimal `activityCompleted`
 * activity whose `target` is the completed activity's IRI. Activity resources
 * are never mutated — 'done' is represented by the existence of a completion,
 * not by a status change. Uses a random IRI like any other activity; duplicate
 * completions (concurrent completers) are accepted for now.
 */
export async function createCompletion(
  data: ActivityRegistryData,
  deps: DataModelDependencies,
  completedIri: string
): Promise<void> {
  const iri = iriForContained(data, deps.randomUUID)
  const doc = withContext(dataModelContext, {
    id: iri,
    type: [INTEROP.Activity],
    activityType: 'activityCompleted',
    target: completedIri,
    createdAt: new Date().toISOString(),
  })
  await putJsonLd(iri, deps.fetch, doc, { 'If-None-Match': '*' })
}

/**
 * IRIs of all completed activities — the `target`s of every `activityCompleted`
 * activity in the registry. Completions are terminal and never reference each
 * other, so no transitive closure is needed. (One load per activity; used by the
 * pending filters and by tests.)
 */
export async function getCompletedActivityIris(
  data: ActivityRegistryData,
  fetch: WhatwgFetch
): Promise<string[]> {
  const iris = await getActivityIris(data, fetch)
  const completed: string[] = []
  for (const iri of iris) {
    const activity = await loadActivity(iri, fetch)
    if (activity.activityType === 'activityCompleted') completed.push(activity.target)
  }
  return completed
}
