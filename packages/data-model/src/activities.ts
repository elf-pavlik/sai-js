import type { AuthorizationStructure, ShareDataInstanceStructure } from './authorization-structures'

// ──────────────────────────
// Activity types (the outbox) — payload-contract-alignment (amended wire)
//
// One interface per activity RDF class (capitalized). `type` is the
// discriminant: the class tuple `['Activity', '<Class>', <as:*>]` — the
// values compact from the `dataModelContext` term definitions when framed.
// Fields are FLAT plain IRIs/literals on the wire (storage law: no
// `{ id, type }` ref objects in SPARQL-queried registries) — `XId` refs
// appear only in the temporal inputs the handler builds from these.
//
// The class's primary object rides as `as:object` in one of two forms
// (the object-embedding amendment — the inventory is the wire truth):
//  - live link — a single `as:object <iri>` triple (the resource exists or
//    is pre-minted via `iriForContained` and materialized by the workflow);
//  - snapshot — a minted `urn:uuid` node embedding the full POJO projection
//    inline in the activity graph (id known only at write; never
//    dereferenced — the singly-fetched activity doc already contains it).
// Parties (`admin`, `authorizationGrantee`, `peerId`, role members) ride the
// object — they are NOT flat fields; consumers read them from the embedded
// or linked POJO.
//
// `AuthorizationRequested`/`ShareRequested` stay flat (structure-based —
// followup in payload-contract-alignment.md §5).
// ──────────────────────────

type ActivityBase = {
  id: string
  /** plain IRI — the changed record/container, or (for ActivityCompleted)
   *  the completed activity IRI — storage law: no ref objects on the wire */
  target: string
  createdAt: string
}

/**
 * Embedded SocialAgentInvitation snapshot (the `InvitationAccepted` object —
 * minted `urn:uuid` node: `type` incl. `interop:SocialAgentInvitation`,
 * the opaque `capabilityUrl`, `prefLabel`, `note`). Never dereferenced.
 */
export type EmbeddedSocialAgentInvitation = {
  id: string
  type: string[]
  capabilityUrl: string
  prefLabel: string
  note?: string
}

/**
 * Embedded SocialAgentRegistration snapshot (the `AgentRegistrationAdded`
 * object — minted `urn:uuid` node: `type` incl.
 * `interop:SocialAgentRegistration`, `registeredAgent` — the peer,
 * `prefLabel`, `note`). Never dereferenced.
 */
export type EmbeddedSocialAgentRegistration = {
  id: string
  type: string[]
  registeredAgent: string
  prefLabel: string
  note?: string
}

/** Acceptance of a social agent invitation (acceptor's Activity Registry). */
export type InvitationAccepted = ActivityBase & {
  type: ['Activity', 'InvitationAccepted', 'as:Accept']
  /** as:actor — plain IRI (the registry owner) */
  actor: string
  /** urn:uuid snapshot of the invitation (opaque capabilityUrl inside) */
  object: EmbeddedSocialAgentInvitation
}

/** Invitation created via RPC (activity-first step 1). */
export type InvitationCreated = ActivityBase & {
  type: ['Activity', 'InvitationCreated', 'as:Create']
  /** as:actor — plain IRI (the registry owner) */
  actor: string
  /** skos:prefLabel */
  label: string
  /** skos:note */
  note?: string
  /** the created invitation — pre-minted id, live-but-pending link (the
   *  workflow PUTs the resource and generates the capabilityUrl there) */
  object: string
}

/** Reciprocal social agent registration written by the invitation handler. */
export type AgentRegistrationAdded = ActivityBase & {
  type: ['Activity', 'AgentRegistrationAdded', 'as:Add']
  /** as:actor — plain IRI (the session that wrote the registration) */
  actor: string
  /** the new social agent registration — pre-minted, the workflow PUTs it */
  target: string
  /** urn:uuid snapshot of the registration (`registeredAgent` — the peer) */
  object: EmbeddedSocialAgentRegistration
}

/** Admin authorization recorded (org context). */
export type AdminAuthorizationRecorded = ActivityBase & {
  type: ['Activity', 'AdminAuthorizationRecorded']
  /** as:actor — plain IRI (the registry owner) */
  actor: string
  /** the AuthorizationRegistry */
  target: string
  /** urn:uuid snapshot of the AdminAuthorization (the admin's `grantee`
   *  inside) — the dispatch dereferences nothing (step 7 moves the
   *  materialization into the workflow and may return to the live-link form) */
  object: EmbeddedAdminAuthorization
}

/**
 * Embedded AdminAuthorization snapshot (the `AdminAuthorizationRevoked`
 * object — minted `urn:uuid` node). The demoted admin's grantee rides here
 * because in A the RPC deletes the AdminAuthorization synchronously — the
 * live-link form (used by `AdminAuthorizationRecorded`) would be unresolvable
 * at dispatch time (step 8 moves the delete into the workflow).
 */
export type EmbeddedAdminAuthorization = {
  id: string
  type: string[]
  grantee: string
  grantedBy: string
  scopeOfAuthorization: string
}

/** Admin authorization revoked (org context). */
export type AdminAuthorizationRevoked = ActivityBase & {
  type: ['Activity', 'AdminAuthorizationRevoked']
  /** as:actor — plain IRI (the registry owner) */
  actor: string
  /** the AuthorizationRegistry */
  target: string
  /** urn:uuid snapshot of the AdminAuthorization (the admin's `grantee`
   *  inside — the RPC deletes the resource synchronously in A, so the
   *  object must embed it; the workflow DELETEs from step 8 on and the
   *  object returns to the live-link form) */
  object: EmbeddedAdminAuthorization
}

/**
 * Embedded request-structure snapshot (the denied `AuthorizationRecorded`
 * object — minted `urn:uuid` node). A denied authorization creates NO
 * DataAuthorization resource (`recordAuthorizationFromStructure` returns []
 * for `granted: false`), so there is nothing to link — the structure's
 * `grantee` rides here (parties ride the object); `hasAccessNeedGroup` is
 * carried for completeness. Only fields with dataModelContext terms survive
 * the wire (agentType/granted are not encoded — the grantee kind resolves in
 * the store and `granted: false` is implied by the snapshot's existence).
 * The granted form keeps the live-link DataAuthorization set.
 */
export type EmbeddedAuthorization = {
  id: string
  type: string[]
  grantee: string
  hasAccessNeedGroup?: string
}

/** Authorization recorded. `grantee` is read from the object — its kind is
 * resolved in the store (`getGrantees` routes by SPARQL), never baked into
 * the activity. */
export type AuthorizationRecorded = ActivityBase & {
  type: ['Activity', 'AuthorizationRecorded']
  /** as:actor — plain IRI (the registry owner) */
  actor: string
  /** the AuthorizationRegistry */
  target: string
  /** granted: the DataAuthorizations — live-link set (one activity per
   *  grantee); denied (no resources are created): a urn:uuid snapshot of the
   *  request structure carrying `grantee` */
  object: string[] | EmbeddedAuthorization
}

/** Authorization revoked (grantee kind resolved in the store). */
export type AuthorizationRevoked = ActivityBase & {
  type: ['Activity', 'AuthorizationRevoked']
  /** as:actor — plain IRI (the registry owner) */
  actor: string
  /** the AuthorizationRegistry */
  target: string
  /** the DataAuthorizations — live-link set (the workflow DELETEs them) */
  object: string[]
}

/** Role membership changed. `target` ≡ the role IRI; the affected members
 * ride the object as a plain-IRI set (A-carrier — the workflow needs them
 * while the RPC still applies the change synchronously; the carrier is
 * pinned in activity-first step 4, where the workflow derives the diff). */
export type RoleMembershipChanged = ActivityBase & {
  type: ['Activity', 'RoleMembershipChanged']
  /** as:actor — plain IRI (the registry owner) */
  actor: string
  /** the changed role */
  target: string
  /** the affected members — interop:hasMember IRIs (A-carrier set) */
  object: string[]
}

/** Role deleted. `target` ≡ the role IRI; `object` = the former members
 * (unresolvable after deletion — the service read the role before). */
export type RoleDeleted = ActivityBase & {
  type: ['Activity', 'RoleDeleted']
  /** as:actor — plain IRI (the registry owner) */
  actor: string
  /** the deleted role */
  target: string
  /** former members — interop:hasMember IRIs (A-carrier set) */
  object: string[]
}

/** Peer mirror grants updated (reciprocal webhook). */
export type DelegatedGrantsUpdated = ActivityBase & {
  type: ['Activity', 'DelegatedGrantsUpdated']
  /** as:actor — plain IRI (the registry owner) */
  actor: string
  /** the peer */
  target: string
  /** the reciprocal registration — live link */
  object: string
}

/** Grants revoked (producer lands in activity-first step 6). */
export type GrantsRevoked = ActivityBase & {
  type: ['Activity', 'GrantsRevoked']
  /** as:actor — plain IRI (the registry owner) */
  actor: string
  /** interop:grantee — plain IRI */
  grantee: string
  /** interop:dataOwner — plain IRI */
  dataOwner: string
  /** the revoked grant IRIs — as:object set */
  object: string[]
}

/** Authorization requested via RPC (future — activity-first step 2). */
export type AuthorizationRequested = ActivityBase & {
  type: ['Activity', 'AuthorizationRequested']
  /** as:actor — plain IRI (the registry owner) */
  actor: string
  /** the requested authorization structure (plain-IRI fields only) */
  authorization: AuthorizationStructure
}

/** Resource sharing requested via RPC (future — activity-first step 3). */
export type ShareRequested = ActivityBase & {
  type: ['Activity', 'ShareRequested']
  /** as:actor — plain IRI (the registry owner) */
  actor: string
  /** the share request structure (plain-IRI fields only) */
  authorization: ShareDataInstanceStructure
  /** the sharing application — plain IRI */
  applicationId: string
}

/** Completion marker — no own fields; `target` is the completed activity IRI. */
export type ActivityCompleted = ActivityBase & {
  type: ['Activity', 'ActivityCompleted']
}

/**
 * The typed activity discriminant union — one member per activity RDF class.
 * Adding a class (the compile-time rule): extend this union, add the vocab
 * term + context entry; the handler, `reconcileActivities` and `events.ts`
 * each add their row to stay exhaustive.
 */
export type ActivityData =
  | InvitationAccepted
  | InvitationCreated
  | AgentRegistrationAdded
  | AdminAuthorizationRecorded
  | AdminAuthorizationRevoked
  | AuthorizationRecorded
  | AuthorizationRevoked
  | RoleMembershipChanged
  | RoleDeleted
  | DelegatedGrantsUpdated
  | GrantsRevoked
  | AuthorizationRequested // future (activity-first step 2)
  | ShareRequested // future (activity-first step 3)
  | ActivityCompleted

/**
 * Whether the activity's `type` tuple contains the given class term
 * (`type[1]` — e.g. `'InvitationAccepted'`, or `'ActivityCompleted'`).
 * The typed union's per-member tuple literals make a bare `.includes` call
 * awkward to type, so the discriminant check lives here.
 */
export function isActivityClass(activity: ActivityData, cls: string): boolean {
  return (activity.type as readonly string[]).includes(cls)
}