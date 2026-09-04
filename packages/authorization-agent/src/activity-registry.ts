import {
  type ActivityData,
  type ActivityRegistryData,
  type CreateInvitationPojo,
  type EmbeddedAdminAuthorization,
  type EmbeddedAuthorization,
  type EmbeddedSocialAgentInvitation,
  type EmbeddedSocialAgentRegistration,
  dataModelContext,
  isActivityClass,
} from '@janeirodigital/interop-data-model'
import type { DataModelDependencies } from './types'
import {
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
 * `If-None-Match: *` (expanded JSON-LD). The typed class tuple
 * (`type: ['Activity', '<Class>', <as:*>]`) and the flat plain-IRI/literal
 * fields + the `as:object` forms serialize directly — no `activityType`,
 * no JSON-string `payload`.
 */
export async function createActivity(
  data: ActivityRegistryData,
  deps: DataModelDependencies,
  activity: Omit<ActivityData, 'id'>
): Promise<ActivityData> {
  const iri = iriForContained(data, deps.randomUUID)
  const doc = withContext(dataModelContext, { ...activity, id: iri })
  await putJsonLd(iri, deps.fetch, doc, { 'If-None-Match': '*' })
  return { ...activity, id: iri } as ActivityData
}

// ──────────────────────────
// Frame + normalization helpers
// ──────────────────────────

/**
 * Frame an activity as a single document (`fetchJsonLd` + `frameDoc` with
 * `object: { '@embed': '@always' }` — the pinned single-doc read). A
 * snapshot object embeds from the same document (no cross-graph read); a
 * live-link object is not in the document and stays a plain-IRI string (the
 * framer never dereferences absent nodes). Every other field frames with the
 * default `@embed: '@never'` — plain IRIs/literals only.
 */
async function frameActivity(id: string, fetch: WhatwgFetch): Promise<Record<string, unknown>> {
  return frameDoc(await fetchJsonLd(id, fetch), dataModelContext, id, {
    object: { '@embed': '@always' },
  })
}

function asString(value: unknown): string {
  if (typeof value === 'string') return value
  if (value && typeof value === 'object') {
    const node = value as { id?: unknown; '@id'?: unknown }
    if (typeof node.id === 'string') return node.id
    if (typeof node['@id'] === 'string') return node['@id']
  }
  return ''
}

/** Normalize a framed (possibly scalar-or-array) node value to a string. */
function asStringArray(value: unknown): string[] {
  if (value === undefined || value === null) return []
  return (Array.isArray(value) ? value : [value]).map(asString)
}

/** The ASV activity types ride the `type` tuple beside the interop class. */
const ASV_ACTIVITY_TYPES = new Set(['as:Accept', 'as:Create', 'as:Add', 'as:Update'])

/**
 * The activity class — the `type` tuple element that is neither the generic
 * `Activity` nor an ASV type. JSON-LD `@type` is an UNORDERED set (the
 * SPARQL store may frame it back in any order), so the class is found by set
 * membership, never by position.
 */
function activityClass(type: string[]): string {
  return type.find((t) => t !== 'Activity' && !ASV_ACTIVITY_TYPES.has(t)) ?? 'Activity'
}

/** Read an activity resource from the Activity Registry into an ActivityData
 * (discriminated on the framed `type`). Refs come back as plain IRIs
 * (storage law); snapshot objects embed their POJO projection. The returned
 * `type` tuple is canonicalized to `['Activity', '<Class>', <as:*>]` — the
 * write order — regardless of the order the store returned it in. */
export async function loadActivity(id: string, fetch: WhatwgFetch): Promise<ActivityData> {
  const node = await frameActivity(id, fetch)
  const type = asStringArray(node.type)
  const cls = activityClass(type)
  const canonicalType = ['Activity', cls, ...type.filter((t) => ASV_ACTIVITY_TYPES.has(t))]
  const base = {
    id,
    target: asString(node.target),
    createdAt: asString(node.createdAt),
  }
  const actor = asString(node.actor)
  switch (cls) {
    case 'InvitationAccepted':
      return {
        id,
        createdAt: asString(node.createdAt),
        type: canonicalType as ['Activity', 'InvitationAccepted', 'as:Accept'],
        actor,
        // the urn:uuid snapshot — fields normalized (a single rdf:type
        // frames as a scalar string; the embedded POJOs type it as string[])
        object: {
          id: asString((node.object as EmbeddedSocialAgentInvitation)?.id),
          type: asStringArray((node.object as EmbeddedSocialAgentInvitation)?.type),
          capabilityUrl: asString((node.object as EmbeddedSocialAgentInvitation)?.capabilityUrl),
          label: asString((node.object as EmbeddedSocialAgentInvitation)?.label),
          note:
            (node.object as EmbeddedSocialAgentInvitation)?.note === undefined
              ? undefined
              : asString((node.object as EmbeddedSocialAgentInvitation)?.note),
        },
      }
    case 'InvitationCreated':
      return {
        id,
        createdAt: asString(node.createdAt),
        type: canonicalType as ['Activity', 'InvitationCreated', 'as:Create'],
        actor,
        object: {
          id: asString((node.object as CreateInvitationPojo)?.id),
          type: asStringArray((node.object as CreateInvitationPojo)?.type),
          label: asString((node.object as CreateInvitationPojo)?.label),
          note:
            (node.object as CreateInvitationPojo)?.note === undefined
              ? undefined
              : asString((node.object as CreateInvitationPojo)?.note),
        },
      }
    case 'AgentRegistrationAdded':
      return {
        ...base,
        type: canonicalType as ['Activity', 'AgentRegistrationAdded', 'as:Add'],
        actor,
        object: {
          id: asString((node.object as EmbeddedSocialAgentRegistration)?.id),
          type: asStringArray((node.object as EmbeddedSocialAgentRegistration)?.type),
          registeredAgent: asString(
            (node.object as EmbeddedSocialAgentRegistration)?.registeredAgent
          ),
          label: asString((node.object as EmbeddedSocialAgentRegistration)?.label),
          note:
            (node.object as EmbeddedSocialAgentRegistration)?.note === undefined
              ? undefined
              : asString((node.object as EmbeddedSocialAgentRegistration)?.note),
        },
      }
    case 'AdminAuthorizationRecorded':
    case 'AdminAuthorizationRevoked':
      return {
        ...base,
        type: canonicalType as
          | ['Activity', 'AdminAuthorizationRecorded']
          | ['Activity', 'AdminAuthorizationRevoked'],
        actor,
        object: {
          id: asString((node.object as EmbeddedAdminAuthorization)?.id),
          type: asStringArray((node.object as EmbeddedAdminAuthorization)?.type),
          grantee: asString((node.object as EmbeddedAdminAuthorization)?.grantee),
          grantedBy: asString((node.object as EmbeddedAdminAuthorization)?.grantedBy),
          scopeOfAuthorization: asString(
            (node.object as EmbeddedAdminAuthorization)?.scopeOfAuthorization
          ),
        },
      }
    case 'AuthorizationRecorded':
      return {
        ...base,
        type: canonicalType as ['Activity', 'AuthorizationRecorded'],
        actor,
        // granted: live-link set; denied: the embedded structure snapshot
        object: Array.isArray(node.object)
          ? asStringArray(node.object)
          : typeof node.object === 'string'
            ? [node.object]
            : {
                id: asString((node.object as EmbeddedAuthorization)?.id),
                type: asStringArray((node.object as EmbeddedAuthorization)?.type),
                grantee: asString((node.object as EmbeddedAuthorization)?.grantee),
                hasAccessNeedGroup: (node.object as EmbeddedAuthorization)?.hasAccessNeedGroup
                  ? asString((node.object as EmbeddedAuthorization)?.hasAccessNeedGroup)
                  : undefined,
              },
      }
    case 'AuthorizationRevoked':
      return {
        ...base,
        type: canonicalType as ['Activity', 'AuthorizationRevoked'],
        actor,
        object: asStringArray(node.object),
      }
    case 'RoleMembershipChanged':
      return {
        ...base,
        type: canonicalType as ['Activity', 'RoleMembershipChanged'],
        actor,
        object: asStringArray(node.object),
      }
    case 'RoleDeleted':
      return {
        ...base,
        type: canonicalType as ['Activity', 'RoleDeleted'],
        actor,
        object: asStringArray(node.object),
      }
    case 'DelegatedGrantsUpdated':
      return {
        ...base,
        type: canonicalType as ['Activity', 'DelegatedGrantsUpdated'],
        actor,
        object: asString(node.object),
      }
    case 'GrantsRevoked':
      return {
        ...base,
        type: canonicalType as ['Activity', 'GrantsRevoked'],
        actor,
        grantee: asString(node.grantee),
        dataOwner: asString(node.dataOwner),
        object: asStringArray(node.object),
      }
    case 'ActivityCompleted':
      return { ...base, type: canonicalType as ['Activity', 'ActivityCompleted'] }
    default:
      throw new Error(`unknown activity class: ${JSON.stringify(type)}`)
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
  completedId: string
): Promise<void> {
  const iri = iriForContained(data, deps.randomUUID)
  const doc = withContext(dataModelContext, {
    id: iri,
    type: ['Activity', 'ActivityCompleted'],
    target: completedId,
    createdAt: new Date().toISOString(),
  })
  await putJsonLd(iri, deps.fetch, doc, { 'If-None-Match': '*' })
}

/**
 * IRIs of all completed activities — the `target`s of every `activityCompleted`
 * activity in the registry (the `type` discriminant). Completions are terminal
 * and never reference each other, so no transitive closure is needed. (One
 * load per activity; used by the pending filters and by tests.)
 */
export async function getCompletedActivityIris(
  data: ActivityRegistryData,
  fetch: WhatwgFetch
): Promise<string[]> {
  const iris = await getActivityIris(data, fetch)
  const completed: string[] = []
  for (const iri of iris) {
    const activity = await loadActivity(iri, fetch)
    if (isActivityClass(activity, 'ActivityCompleted')) completed.push(activity.target)
  }
  return completed
}