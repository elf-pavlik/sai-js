import {
  type ActivityData,
  type ActivityRegistryData,
  type CreateInvitationPojo,
  type EmbeddedAdminAuthorization,
  type EmbeddedAuthorization,
  type EmbeddedNeedBasedAccessRequest,
  type EmbeddedSocialAgentInvitation,
  type EmbeddedSocialAgentRegistration,
  type RoleData,
  compactNodeToDataAuthorizationData,
  dataModelContext,
  isActivityClass,
} from '@janeirodigital/interop-data-model'
import type { DataModelDependencies } from './types'
import { INTEROP,
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
  const doc = await fetchJsonLd(id, fetch)
  // the need-based classes embed the request SNAPSHOT (their objects are
  // never live links) — the group inside must stay COMPLETE (sparql.md: the
  // activity graph is self-contained; its needs incl. inherited children
  // ride the graph, or the approval cannot resolve the group). The deep
  // frame is CLASS-GATED: a per-property sub-frame is a whitelist that would
  // mis-frame the LIVE-LINK object arrays of the other classes.
  const needBasedClasses = [INTEROP.NeedBasedAccessRequestSent, INTEROP.NeedBasedAccessRequestReceived]
  const nodes = Array.isArray(doc) ? doc : [doc]
  const isNeedBased = nodes.some((node) => {
    const types = typeof node?.['@type'] === 'string' ? [node['@type']] : (node?.['@type'] ?? [])
    return types.some((type: string) => needBasedClasses.includes(type))
  })
  return frameDoc(doc, dataModelContext, id, {
    object: isNeedBased
      ? {
          '@embed': '@always',
          hasAccessNeedGroup: {
            '@embed': '@always',
            hasAccessNeed: {
              '@embed': '@always',
              hasInheritingNeed: { '@embed': '@always' },
            },
          },
        }
      : { '@embed': '@always' },
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
    case 'NeedBasedAccessRequestSent':
      // target dropped — the request snapshot (urn:uuid id, the embedded
      // access need group) rides the object; the requester-side workflow
      // forwards it to the data owner's (reused) issuance endpoint
      {
        const embedded = node.object as EmbeddedNeedBasedAccessRequest | undefined
        const group = embedded?.hasAccessNeedGroup
        return {
          id,
          createdAt: asString(node.createdAt),
          type: canonicalType as ['Activity', 'NeedBasedAccessRequestSent'],
          actor,
          object: {
            id: asString(embedded?.id),
            type: asStringArray(embedded?.type),
            grantee: asString(embedded?.grantee),
            grantedBy: asString(embedded?.grantedBy),
            dataOwner: asString(embedded?.dataOwner),
            // the framed group node is NORMALIZED like the other embedded
            // objects — a single rdf:type frames as a scalar, so `type`
            // goes through asStringArray (no shape assertion)
            hasAccessNeedGroup: {
              id: asString(group),
              type: asStringArray(group?.type),
              hasAccessNeed: group?.hasAccessNeed ?? [],
            },
          },
        }
      }
    case 'NeedBasedAccessRequestReceived':
      // minted half — `target` = the AccessRequest registry; the object is
      // the request-to-be as a REAL-ID embedded projection at the minted id;
      // the owner-side workflow PUTs the AccessRequest resource there
      {
        const embedded = node.object as EmbeddedNeedBasedAccessRequest | undefined
        const group = embedded?.hasAccessNeedGroup
        return {
          ...base,
          type: canonicalType as ['Activity', 'NeedBasedAccessRequestReceived'],
          actor,
          object: {
            id: asString(embedded?.id),
            type: asStringArray(embedded?.type),
            grantee: asString(embedded?.grantee),
            grantedBy: asString(embedded?.grantedBy),
            dataOwner: asString(embedded?.dataOwner),
            hasAccessNeedGroup: {
              id: asString(group),
              type: asStringArray(group?.type),
              hasAccessNeed: group?.hasAccessNeed ?? [],
            },
          },
        }
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
    case 'AdminAuthorizationGranted':
      // target dropped (step 5) — the AdminAuthorization-to-be (real-id
      // embedded projection at the pre-minted id) rides the object; the
      // addAdmin workflow PUTs the resource at object.id
      return {
        id,
        createdAt: asString(node.createdAt),
        type: canonicalType as ['Activity', 'AdminAuthorizationGranted'],
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
    case 'AdminAuthorizationRevoked':
      // target dropped (step 6) — the existing AdminAuthorization (real-id
      // embedded projection at its id, alive at write) rides the object; the
      // removeAdmin workflow DELETEs the resource at object.id
      return {
        id,
        createdAt: asString(node.createdAt),
        type: canonicalType as ['Activity', 'AdminAuthorizationRevoked'],
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
    case 'AuthorizationGranted': {
      // the object is the array of embedded DataAuthorization POJOs (ALL
      // grantees); a SINGLE embedded node frames as an object, not an array
      // (jsonld.md gotcha 1) — wrap it. Declines are `AuthorizationDenied`
      // (Step 4): no snapshot form lives on this class anymore.
      return {
        ...base,
        type: canonicalType as ['Activity', 'AuthorizationGranted'],
        actor,
        object:
          node.object === undefined
            ? []
            : Array.isArray(node.object)
              ? node.object.map((member) => compactNodeToDataAuthorizationData(member))
              : [compactNodeToDataAuthorizationData(node.object)],
      }
    }
    case 'AuthorizationDenied': {
      // decline — no `target`; the request-structure snapshot (urn:uuid)
      // carrying `grantee` rides the object; cast once per object
      const embedded = node.object as EmbeddedAuthorization | undefined
      return {
        id,
        createdAt: asString(node.createdAt),
        type: canonicalType as ['Activity', 'AuthorizationDenied'],
        actor,
        object: {
          id: asString(embedded?.id),
          type: asStringArray(embedded?.type),
          grantee: asString(embedded?.grantee),
          hasAccessNeedGroup: embedded?.hasAccessNeedGroup
            ? asString(embedded?.hasAccessNeedGroup)
            : undefined,
        },
      }
    }
    case 'AuthorizationRevoked':
      return {
        ...base,
        type: canonicalType as ['Activity', 'AuthorizationRevoked'],
        actor,
        object: asStringArray(node.object),
      }
    case 'RoleCreated':
      // target dropped (step 9) — the role-to-be (real-id embedded
      // projection at the PRE-MINTED id) rides the object; the workflow
      // PUTs the role at object.id
      return {
        id,
        createdAt: asString(node.createdAt),
        type: canonicalType as ['Activity', 'RoleCreated', 'as:Add'],
        actor,
        object: {
          id: asString((node.object as RoleData)?.id),
          type: asStringArray((node.object as RoleData)?.type),
          label: asString((node.object as RoleData)?.label),
          members: asStringArray((node.object as RoleData)?.members),
        },
      }
    case 'RoleMembershipChanged':
      // target dropped (step 2) — the role-to-be (real-id embedded
      // projection) rides the object; the workflow PATCHes the role to it
      return {
        id,
        createdAt: asString(node.createdAt),
        type: canonicalType as ['Activity', 'RoleMembershipChanged', 'as:Update'],
        actor,
        object: {
          id: asString((node.object as RoleData)?.id),
          type: asStringArray((node.object as RoleData)?.type),
          label: asString((node.object as RoleData)?.label),
          members: asStringArray((node.object as RoleData)?.members),
        },
      }
    case 'RoleDeleted':
      // target dropped (step 3) — the role-to-be-deleted (real-id embedded
      // projection, alive at write) rides the object; the workflow DELETEs it
      return {
        id,
        createdAt: asString(node.createdAt),
        type: canonicalType as ['Activity', 'RoleDeleted'],
        actor,
        object: {
          id: asString((node.object as RoleData)?.id),
          type: asStringArray((node.object as RoleData)?.type),
          label: asString((node.object as RoleData)?.label),
          members: asStringArray((node.object as RoleData)?.members),
        },
      }
    case 'DelegatedGrantsUpdated':
      return {
        ...base,
        type: canonicalType as ['Activity', 'DelegatedGrantsUpdated'],
        actor,
        object: asString(node.object),
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