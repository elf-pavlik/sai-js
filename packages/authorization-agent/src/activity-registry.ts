import {
  type ActivityData,
  type ActivityRegistryData,
  dataModelContext,
} from '@janeirodigital/interop-data-model'
import type { DataModelDependencies } from './types'
import {
  INTEROP,
  LDP,
  type WhatwgFetch,
  fetchJsonLd,
  frameDoc,
  iriForContained,
  linkedIrisJsonLd,
  putJsonLd,
  withContext,
} from '@janeirodigital/interop-utils'

/** The activity resources currently in the registry (ldp:contains). */
export async function getActivityIris(
  data: ActivityRegistryData,
  fetch: WhatwgFetch
): Promise<string[]> {
  return linkedIrisJsonLd(data.id, fetch, LDP.contains)
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
