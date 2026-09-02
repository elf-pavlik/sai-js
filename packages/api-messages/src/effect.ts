import { Rpc, RpcRouter } from '@effect/rpc'
import { Context, Effect, pipe } from 'effect'
import * as S from 'effect/Schema'
import type { PushSubscription } from 'web-push'

export const IRI = pipe(S.String, S.brand('IRI'))
export type IRI = S.Schema.Type<typeof IRI>

export enum Scopes {
  Inherited = 'Inherited',
  All = 'All',
  AllFromAgent = 'AllFromAgent',
  AllFromRole = 'AllFromRole',
  AllFromRegistry = 'AllFromRegistry',
  SelectedFromRegistry = 'SelectedFromRegistry',
}

export const AccessModes = {
  Read: 'http://www.w3.org/ns/auth/acl#Read',
  Update: 'http://www.w3.org/ns/auth/acl#Update',
  Create: 'http://www.w3.org/ns/auth/acl#Create',
  Delete: 'http://www.w3.org/ns/auth/acl#Delete',
} as const

export enum AgentType {
  SocialAgent = 'http://www.w3.org/ns/solid/interop#SocialAgent',
  Role = 'http://www.w3.org/ns/solid/interop#Role',
  Application = 'http://www.w3.org/ns/solid/interop#Application',
}

export const WebPushSubscription = S.Struct({
  endpoint: S.String,
  keys: S.Struct({
    p256dh: S.String,
    auth: S.String,
  }),
})

export const Application = S.Struct({
  id: IRI,
  name: S.String,
  logo: S.optional(S.String),
  callbackEndpoint: S.optional(S.String),
  //authorizationDate: S.String, // interop:registeredAt
  //lastUpdateDate: S.optional(S.String), // interop:updatedAt
  accessNeedGroup: S.String, // interop:hasAccessNeedGroup
})

export const ApplicationList = S.Array(Application)

export const UnregisteredApplication = S.Struct({
  id: IRI,
  name: S.String,
  logo: S.optional(S.String),
  accessNeedGroup: S.String, // interop:hasAccessNeedGroup
})

const accessNeedFields = {
  id: IRI,
  label: S.String,
  description: S.optional(S.String),
  required: S.optional(S.Boolean),
  // IRIs for the access modes
  access: S.Array(IRI),
  shapeTree: S.Struct({
    id: IRI,
    label: S.String,
  }),
  parent: S.optional(IRI),
}

interface AccessNeed extends S.Struct.Type<typeof accessNeedFields> {
  readonly children?: ReadonlyArray<AccessNeed>
}

interface AccessNeedEncoded extends S.Struct.Encoded<typeof accessNeedFields> {
  readonly children?: ReadonlyArray<AccessNeedEncoded>
}

export const AccessNeed = S.Struct({
  ...accessNeedFields,
  children: S.optional(
    S.Array(S.suspend((): S.Schema<AccessNeed, AccessNeedEncoded> => AccessNeed))
  ),
})

export const AccessNeedGroup = S.Struct({
  id: IRI,
  label: S.String,
  description: S.optional(S.String),
  required: S.optional(S.Boolean),
  needs: S.Array(AccessNeed),
  descriptionLanguages: S.Array(S.String),
  lang: S.String,
})

export const DataRegistration = S.Struct({
  id: IRI,
  shapeTree: S.String,
  // TODO dataOwner: IRI,
  dataRegistry: S.optional(S.String),
  count: S.optional(S.Number),
  label: S.optional(S.String), // TODO label should be ensured
})

export const DataOwner = S.Struct({
  id: IRI,
  label: S.String,
  dataRegistrations: S.Array(DataRegistration),
})

export const AuthorizationData = S.Struct({
  id: IRI, // TODO change to agentId
  agentType: S.Enums(AgentType),
  accessNeedGroup: AccessNeedGroup,
  dataOwners: S.Array(DataOwner),
})

export const ShapeTree = S.Struct({
  id: IRI,
  label: S.String,
})

export const ChildInfo = S.Struct({
  count: S.Int,
  shapeTree: ShapeTree,
})

export const Resource = S.Struct({
  id: IRI,
  label: S.optional(S.String),
  shapeTree: ShapeTree,
  children: S.Array(ChildInfo),
  accessGrantedTo: S.Array(IRI),
})

export const SocialAgent = S.Struct({
  id: IRI,
  label: S.String,
  note: S.optional(S.String),
  accessNeedGroup: S.optional(S.String),
  accessRequested: S.Boolean,
  accessGrant: S.optional(S.String),
  /**
   * True when the agent holds an admin marker in the *current context's*
   * registry. Asymmetry (§2.2 of org-admin-feature.md): in the personal
   * context it is read from the agent's registration of the signed-in user
   * (reached via `reciprocalRegistration`); in an org context it is read from
   * the org's registration of the agent directly (non-empty `hasAdminGrant`).
   */
  admin: S.Boolean,
  //authorizationDate: S.String, // interop:registeredAt TODO: rename to not imply access
  //lastUpdateDate: S.optional(S.String), // interop:updatedAt
})

export const SocialAgentList = S.Array(SocialAgent)

export const Role = S.Struct({
  id: IRI,
  label: S.String,
  members: S.Array(IRI),
})

export const RoleList = S.Array(Role)

export const SocialAgentInvitation = S.Struct({
  id: IRI,
  label: S.String,
  note: S.optional(S.String),
  capabilityUrl: S.String,
})

export const SocialAgentInvitationList = S.Array(SocialAgentInvitation)

/**
 * Pending acknowledgment of an accepted invitation — the acceptance itself
 * completes asynchronously via the acceptor's `invitationAccepted` workflow.
 * `Message` suffix per the RPC naming rule (payload-contract-alignment §2):
 * the name `InvitationAccepted` is the activity class Schema below.
 */
export const InvitationAcceptedMessage = S.Struct({
  accepted: S.Boolean,
})

// ──────────────────────────
// Activity projections (the outbox) — payload-contract-alignment step 3
// (amended wire). Same field sets as the data-model ActivityData union
// (wire truth), UNBRANDED: every IRI field is plain S.String — no refs on
// the wire, so no ActorRef (refs stay data-model XId types for temporal
// inputs). The `as:object` forms: live-link objects are plain S.String,
// sets are S.Array(S.String), snapshots embed their POJO projection.
// ──────────────────────────

const activityBaseFields = {
  id: S.String,
  /** plain IRI — the changed record/container, or the completed activity IRI */
  target: S.String,
  createdAt: S.String,
}

/** Unbranded projection of data-model `DataAuthorizationStructure`. */
export const DataAuthorizationStructure = S.Struct({
  accessNeed: S.String,
  scopeOfAuthorization: S.String,
  dataOwner: S.optional(S.String),
  hasDataRegistration: S.optional(S.String),
  hasDataInstance: S.optional(S.Array(S.String)),
})

/** Unbranded projection of data-model `AuthorizationStructure`. */
export const AuthorizationStructure = S.Struct({
  grantee: S.String,
  agentType: S.String,
  hasAccessNeedGroup: S.optional(S.String),
  granted: S.Boolean,
  dataAuthorizations: S.optional(S.Array(DataAuthorizationStructure)),
})

/** Unbranded projection of data-model `ShareDataInstanceStructure`. */
export const ShareDataInstanceStructure = S.Struct({
  applicationId: S.String,
  resource: S.String,
  accessMode: S.Array(S.String),
  children: S.Array(
    S.Struct({
      shapeTree: S.String,
      accessMode: S.Array(S.String),
    })
  ),
  agents: S.Array(S.String),
})

/** Unbranded projection of data-model `EmbeddedSocialAgentInvitation` —
 * the `InvitationAccepted` object (urn:uuid snapshot, never dereferenced). */
export const EmbeddedSocialAgentInvitation = S.Struct({
  id: S.String,
  type: S.Array(S.String),
  capabilityUrl: S.String,
  prefLabel: S.String,
  note: S.optional(S.String),
})

/** Unbranded projection of data-model `EmbeddedSocialAgentRegistration` —
 * the `AgentRegistrationAdded` object (urn:uuid snapshot). */
export const EmbeddedSocialAgentRegistration = S.Struct({
  id: S.String,
  type: S.Array(S.String),
  registeredAgent: S.String,
  prefLabel: S.String,
  note: S.optional(S.String),
})

/** Acceptance of a social agent invitation (acceptor's Activity Registry). */
export const InvitationAccepted = S.Struct({
  ...activityBaseFields,
  type: S.Tuple(
    S.Literal('Activity'),
    S.Literal('InvitationAccepted'),
    S.Literal('as:Accept')
  ),
  /** as:actor — plain IRI (the registry owner) */
  actor: S.String,
  /** urn:uuid snapshot of the invitation (opaque capabilityUrl inside) */
  object: EmbeddedSocialAgentInvitation,
})

/** Invitation created via RPC (activity-first step 1). */
export const InvitationCreated = S.Struct({
  ...activityBaseFields,
  type: S.Tuple(S.Literal('Activity'), S.Literal('InvitationCreated'), S.Literal('as:Create')),
  /** as:actor — plain IRI (the registry owner) */
  actor: S.String,
  label: S.String,
  note: S.optional(S.String),
  /** the created invitation — pre-minted id, live-but-pending link */
  object: S.String,
})

/** Reciprocal social agent registration written by the invitation handler. */
export const AgentRegistrationAdded = S.Struct({
  ...activityBaseFields,
  type: S.Tuple(S.Literal('Activity'), S.Literal('AgentRegistrationAdded'), S.Literal('as:Add')),
  /** as:actor — plain IRI (the session that wrote the registration) */
  actor: S.String,
  /** the new social agent registration — pre-minted, the workflow PUTs it */
  target: S.String,
  /** urn:uuid snapshot of the registration (`registeredAgent` — the peer) */
  object: EmbeddedSocialAgentRegistration,
})

/** Unbranded projection of data-model `EmbeddedAdminAuthorization` — the
 * `AdminAuthorizationRevoked` object (urn:uuid snapshot — the RPC deletes
 * the resource synchronously in A, so the admin's grantee rides inside). */
export const EmbeddedAdminAuthorization = S.Struct({
  id: S.String,
  type: S.Array(S.String),
  grantee: S.String,
  grantedBy: S.String,
  scopeOfAuthorization: S.String,
})

/** Admin authorization recorded (org context). */
export const AdminAuthorizationRecorded = S.Struct({
  ...activityBaseFields,
  type: S.Tuple(S.Literal('Activity'), S.Literal('AdminAuthorizationRecorded')),
  /** as:actor — plain IRI (the registry owner) */
  actor: S.String,
  /** the AdminAuthorization — urn:uuid snapshot (the admin's grantee inside) */
  object: EmbeddedAdminAuthorization,
})

/** Admin authorization revoked (org context). */
export const AdminAuthorizationRevoked = S.Struct({
  ...activityBaseFields,
  type: S.Tuple(S.Literal('Activity'), S.Literal('AdminAuthorizationRevoked')),
  /** as:actor — plain IRI (the registry owner) */
  actor: S.String,
  /** the AdminAuthorization — urn:uuid snapshot (the admin's grantee inside) */
  object: EmbeddedAdminAuthorization,
})

/** Unbranded projection of data-model `EmbeddedAuthorization` — the denied
 * `AuthorizationRecorded` object (urn:uuid snapshot of the request structure;
 * a denied authorization creates no DataAuthorization, so `grantee` rides
 * here). */
export const EmbeddedAuthorization = S.Struct({
  id: S.String,
  type: S.Array(S.String),
  grantee: S.String,
  hasAccessNeedGroup: S.optional(S.String),
})

/** Authorization recorded — granted: the DataAuthorization live-link set;
 * denied: the request-structure snapshot (grantee kind resolved in the store). */
export const AuthorizationRecorded = S.Struct({
  ...activityBaseFields,
  type: S.Tuple(S.Literal('Activity'), S.Literal('AuthorizationRecorded')),
  /** as:actor — plain IRI (the registry owner) */
  actor: S.String,
  /** the DataAuthorizations (live-link set) or the structure snapshot */
  object: S.Union(S.Array(S.String), EmbeddedAuthorization),
})

/** Authorization revoked — `object` = the DataAuthorization live-link set. */
export const AuthorizationRevoked = S.Struct({
  ...activityBaseFields,
  type: S.Tuple(S.Literal('Activity'), S.Literal('AuthorizationRevoked')),
  /** as:actor — plain IRI (the registry owner) */
  actor: S.String,
  /** the DataAuthorizations — live-link set */
  object: S.Array(S.String),
})

/** Role membership changed — `target` ≡ the role; `object` = the affected
 * members (A-carrier set; the carrier is pinned in activity-first step 4). */
export const RoleMembershipChanged = S.Struct({
  ...activityBaseFields,
  type: S.Tuple(S.Literal('Activity'), S.Literal('RoleMembershipChanged')),
  /** as:actor — plain IRI (the registry owner) */
  actor: S.String,
  /** the changed role */
  target: S.String,
  /** the affected members — interop:hasMember IRIs */
  object: S.Array(S.String),
})

/** Role deleted — `target` ≡ the role; `object` = the former members. */
export const RoleDeleted = S.Struct({
  ...activityBaseFields,
  type: S.Tuple(S.Literal('Activity'), S.Literal('RoleDeleted')),
  /** as:actor — plain IRI (the registry owner) */
  actor: S.String,
  /** the deleted role */
  target: S.String,
  /** former members — interop:hasMember IRIs */
  object: S.Array(S.String),
})

/** Peer mirror grants updated (reciprocal webhook). */
export const DelegatedGrantsUpdated = S.Struct({
  ...activityBaseFields,
  type: S.Tuple(S.Literal('Activity'), S.Literal('DelegatedGrantsUpdated')),
  /** as:actor — plain IRI (the registry owner) */
  actor: S.String,
  /** the peer */
  target: S.String,
  /** the reciprocal registration — live link */
  object: S.String,
})

/** Grants revoked (producer lands in activity-first step 6). */
export const GrantsRevoked = S.Struct({
  ...activityBaseFields,
  type: S.Tuple(S.Literal('Activity'), S.Literal('GrantsRevoked')),
  /** as:actor — plain IRI (the registry owner) */
  actor: S.String,
  grantee: S.String,
  dataOwner: S.String,
  /** the revoked grant IRIs — as:object set */
  object: S.Array(S.String),
})

/** Authorization requested via RPC (future — activity-first step 2). */
export const AuthorizationRequested = S.Struct({
  ...activityBaseFields,
  type: S.Tuple(S.Literal('Activity'), S.Literal('AuthorizationRequested')),
  /** as:actor — plain IRI (the registry owner) */
  actor: S.String,
  authorization: AuthorizationStructure,
})

/** Resource sharing requested via RPC (future — activity-first step 3). */
export const ShareRequested = S.Struct({
  ...activityBaseFields,
  type: S.Tuple(S.Literal('Activity'), S.Literal('ShareRequested')),
  /** as:actor — plain IRI (the registry owner) */
  actor: S.String,
  authorization: ShareDataInstanceStructure,
  applicationId: S.String,
})

/** Completion marker — no own fields; `target` is the completed activity IRI. */
export const ActivityCompleted = S.Struct({
  ...activityBaseFields,
  type: S.Tuple(S.Literal('Activity'), S.Literal('ActivityCompleted')),
})

export const DataRegistry = S.Struct({
  id: IRI,
  label: S.String,
  registrations: S.Array(DataRegistration),
})

export const DataRegistryList = S.Array(DataRegistry)

export const DataInstance = S.Struct({
  id: IRI,
  label: S.String,
})

export const DataInstanceList = S.Array(DataInstance)

export const ShareAuthorization = S.Struct({
  applicationId: IRI,
  resource: IRI,
  agents: S.Array(IRI),
  accessMode: S.Array(IRI),
  children: S.Array(
    S.Struct({
      shapeTree: IRI,
      accessMode: S.Array(IRI),
    })
  ),
})

export const ShareAuthorizationConfirmation = S.Struct({
  callbackEndpoint: S.String,
})

export const BaseAuthorization = S.Struct({
  grantee: IRI,
  agentType: S.Enums(AgentType),
  accessNeedGroup: IRI,
})

export const DataAuthorization = S.Struct({
  accessNeed: IRI,
  scope: S.Enums(Scopes),
  dataOwner: S.optional(IRI),
  dataRegistration: S.optional(IRI),
  dataInstances: S.optional(S.Array(IRI)),
})

export const GrantedAuthorization = S.Struct({
  ...BaseAuthorization.fields,
  dataAuthorizations: S.Array(DataAuthorization),
  granted: S.Literal(true),
})

export const DeniedAuthorization = S.Struct({
  ...BaseAuthorization.fields,
  granted: S.Literal(false),
})

export const Authorization = S.Union(GrantedAuthorization, DeniedAuthorization)

/** A data authorization as recorded by the authorization agent (API response). */
export const RecordedDataAuthorization = S.Struct({
  id: IRI,
  grantee: IRI,
  grantedBy: IRI,
  registeredShapeTree: IRI,
  scopeOfAuthorization: IRI,
  dataOwner: S.optional(IRI),
  hasDataRegistration: S.optional(IRI),
  satisfiesAccessNeed: S.optional(IRI),
  inheritsFromAuthorization: S.optional(IRI),
  accessMode: S.Array(IRI),
  creatorAccessMode: S.optional(S.Array(IRI)),
  hasDataInstance: S.optional(S.Array(IRI)),
  hasInheritingAuthorization: S.optional(S.Array(IRI)),
})

export const AccessAuthorization = S.Array(RecordedDataAuthorization)

export class GetWebId extends S.TaggedRequest<GetWebId>()('GetWebId', {
  failure: S.Never,
  success: S.String,
  payload: {},
}) {}

export class CheckHandle extends S.TaggedRequest<CheckHandle>()('CheckHandle', {
  failure: S.Never,
  success: S.Boolean,
  payload: { handle: S.String },
}) {}

export class BootstrapAccount extends S.TaggedRequest<BootstrapAccount>()('BootstrapAccount', {
  failure: S.Never,
  success: S.String,
  payload: { handle: S.String },
}) {}

export class RegisterPushSubscription extends S.TaggedRequest<RegisterPushSubscription>()(
  'RegisterPushSubscription',
  {
    failure: S.Never,
    success: S.Void,
    payload: {
      subscription: WebPushSubscription,
    },
  }
) {}

export class ListApplications extends S.TaggedRequest<ListApplications>()('ListApplications', {
  failure: S.Never,
  success: ApplicationList,
  payload: { context: IRI },
}) {}

export class GetUnregisteredApplication extends S.TaggedRequest<GetUnregisteredApplication>()(
  'GetUnregisteredApplication',
  {
    failure: S.Never,
    success: UnregisteredApplication,
    payload: { id: IRI },
  }
) {}

export class GetAuthoriaztionData extends S.TaggedRequest<GetAuthoriaztionData>()(
  'GetAuthoriaztionData',
  {
    failure: S.Never,
    success: AuthorizationData,
    payload: {
      agentId: IRI,
      agentType: S.Enums(AgentType),
      lang: S.String,
      accessNeedGroupIri: S.optional(IRI),
      context: IRI,
    },
  }
) {}

export class GetResource extends S.TaggedRequest<GetResource>()('GetResource', {
  failure: S.Never,
  success: Resource,
  payload: {
    id: IRI,
    lang: S.String, // TODO lang code validation
    context: IRI,
  },
}) {}

export class ListSocialAgents extends S.TaggedRequest<ListSocialAgents>()('ListSocialAgents', {
  failure: S.Never,
  success: SocialAgentList,
  payload: { context: IRI },
}) {}

export class ListSocialAgentInvitations extends S.TaggedRequest<ListSocialAgentInvitations>()(
  'ListSocialAgentInvitations',
  {
    failure: S.Never,
    success: SocialAgentInvitationList,
    payload: { context: IRI },
  }
) {}

export class ListRoles extends S.TaggedRequest<ListRoles>()('ListRoles', {
  failure: S.Never,
  success: RoleList,
  payload: { context: IRI },
}) {}

export class CreateRole extends S.TaggedRequest<CreateRole>()('CreateRole', {
  failure: S.Never,
  success: Role,
  payload: {
    label: S.String,
    members: S.Array(IRI),
    context: IRI,
  },
}) {}

export class UpdateRole extends S.TaggedRequest<UpdateRole>()('UpdateRole', {
  failure: S.Never,
  success: Role,
  payload: {
    id: IRI,
    label: S.String,
    members: S.Array(IRI),
    context: IRI,
  },
}) {}

export class DeleteRole extends S.TaggedRequest<DeleteRole>()('DeleteRole', {
  failure: S.Never,
  success: S.Void,
  payload: {
    id: IRI,
    context: IRI,
  },
}) {}

export class ListDataRegistries extends S.TaggedRequest<ListDataRegistries>()(
  'ListDataRegistries',
  {
    failure: S.Never,
    success: DataRegistryList,
    payload: {
      agentId: IRI,
      lang: S.String, // TODO lang code validation
      context: IRI,
    },
  }
) {}

export class ListDataInstances extends S.TaggedRequest<ListDataInstances>()('ListDataInstances', {
  failure: S.Never,
  success: DataInstanceList,
  payload: {
    agentId: IRI,
    registrationId: IRI,
    context: IRI,
  },
}) {}

export class RequestAccessUsingApplicationNeeds extends S.TaggedRequest<RequestAccessUsingApplicationNeeds>()(
  'RequestAccessUsingApplicationNeeds',
  {
    failure: S.Never,
    success: S.Void,
    payload: {
      applicationId: IRI,
      agentId: IRI,
      context: IRI,
    },
  }
) {}

export class CreateInvitation extends S.TaggedRequest<CreateInvitation>()('CreateInvitation', {
  failure: S.Never,
  success: SocialAgentInvitation,
  payload: {
    label: S.String,
    note: S.optional(S.String),
    context: IRI,
  },
}) {}

export class AcceptInvitation extends S.TaggedRequest<AcceptInvitation>()('AcceptInvitation', {
  failure: S.Never,
  success: InvitationAcceptedMessage,
  payload: {
    capabilityUrl: S.String,
    label: S.String,
    note: S.optional(S.String),
    context: IRI,
  },
}) {}

export class ShareResource extends S.TaggedRequest<ShareResource>()('ShareResource', {
  failure: S.Never,
  success: ShareAuthorizationConfirmation,
  payload: {
    authorization: ShareAuthorization,
    context: IRI,
  },
}) {}

export class AuthorizeApp extends S.TaggedRequest<AuthorizeApp>()('AuthorizeApp', {
  failure: S.Never,
  success: AccessAuthorization,
  payload: {
    authorization: Authorization,
    context: IRI,
  },
}) {}

export class RevokeGrants extends S.TaggedRequest<RevokeGrants>()('RevokeGrants', {
  failure: S.Never,
  success: S.Array(IRI),
  payload: {
    grants: S.Array(IRI),
    context: IRI,
  },
}) {}

export class AddAdmin extends S.TaggedRequest<AddAdmin>()('AddAdmin', {
  failure: S.Never,
  success: SocialAgent,
  payload: { webId: IRI, context: IRI },
}) {}

export class RemoveAdmin extends S.TaggedRequest<RemoveAdmin>()('RemoveAdmin', {
  failure: S.Never,
  success: SocialAgent,
  payload: { webId: IRI, context: IRI },
}) {}

export class SaiService extends Context.Tag('SaiService')<
  SaiService,
  {
    readonly getWebId: () => Effect.Effect<S.Schema.Type<typeof S.String>>
    readonly checkHandle: (handle: string) => Effect.Effect<S.Schema.Type<typeof S.Boolean>>
    readonly bootstrapAccount: (handle: string) => Effect.Effect<S.Schema.Type<typeof S.String>>
    readonly registerPushSubscription: (
      subscription: PushSubscription
    ) => Effect.Effect<S.Schema.Type<typeof S.Void>>
    readonly getApplications: (
      context: IRI
    ) => Effect.Effect<S.Schema.Type<typeof ApplicationList>>
    readonly getUnregisteredApplication: (
      id: IRI
    ) => Effect.Effect<S.Schema.Type<typeof UnregisteredApplication>>
    readonly getAuthorizationData: (
      agentId: IRI,
      agentType: AgentType,
      lang: string,
      accessNeedGroupIri: IRI | undefined,
      context: IRI
    ) => Effect.Effect<S.Schema.Type<typeof AuthorizationData>>
    readonly getResource: (
      id: IRI,
      lang: string,
      context: IRI
    ) => Effect.Effect<S.Schema.Type<typeof Resource>>
    readonly getSocialAgents: (context: IRI) => Effect.Effect<S.Schema.Type<typeof SocialAgentList>>
    readonly getRoles: (context: IRI) => Effect.Effect<S.Schema.Type<typeof RoleList>>
    readonly createRole: (
      label: string,
      members: readonly S.Schema.Type<typeof IRI>[],
      context: IRI
    ) => Effect.Effect<S.Schema.Type<typeof Role>>
    readonly updateRole: (
      id: IRI,
      label: string,
      members: readonly S.Schema.Type<typeof IRI>[],
      context: IRI
    ) => Effect.Effect<S.Schema.Type<typeof Role>>
    readonly deleteRole: (id: IRI, context: IRI) => Effect.Effect<S.Schema.Type<typeof S.Void>>
    readonly getSocialAgentInvitations: (context: IRI) => Effect.Effect<
      S.Schema.Type<typeof SocialAgentInvitationList>
    >
    readonly getDataRegistries: (
      agentId: IRI,
      lang: string,
      context: IRI
    ) => Effect.Effect<S.Schema.Type<typeof DataRegistryList>>
    readonly listDataInstances: (
      agentId: IRI,
      registrationId: string,
      context: IRI
    ) => Effect.Effect<S.Schema.Type<typeof DataInstanceList>>
    readonly requestAccessUsingApplicationNeeds: (
      applicationId: string,
      agentId: string,
      context: IRI
    ) => Effect.Effect<S.Schema.Type<typeof S.Void>>
    readonly createInvitation: (
      label: string,
      note: string | undefined,
      context: IRI
    ) => Effect.Effect<S.Schema.Type<typeof SocialAgentInvitation>>
    readonly acceptInvitation: (
      capabilityUrl: string,
      label: string,
      note: string | undefined,
      context: IRI
    ) => Effect.Effect<S.Schema.Type<typeof InvitationAcceptedMessage>>
    readonly shareResource: (
      authorization: S.Schema.Type<typeof ShareAuthorization>,
      context: IRI
    ) => Effect.Effect<S.Schema.Type<typeof ShareAuthorizationConfirmation>>
    readonly authorizeApp: (
      authorization: S.Schema.Type<typeof Authorization>,
      context: IRI
    ) => Effect.Effect<S.Schema.Type<typeof AccessAuthorization>>
    readonly revokeGrants: (
      grants: readonly S.Schema.Type<typeof IRI>[],
      context: IRI
    ) => Effect.Effect<readonly S.Schema.Type<typeof IRI>[]>
    readonly addAdmin: (webId: IRI, context: IRI) => Effect.Effect<S.Schema.Type<typeof SocialAgent>>
    readonly removeAdmin: (webId: IRI, context: IRI) => Effect.Effect<
      S.Schema.Type<typeof SocialAgent>
    >
  }
>() {}

export const router = RpcRouter.make(
  Rpc.effect(GetWebId, () =>
    Effect.gen(function* () {
      const saiService = yield* SaiService
      return yield* saiService.getWebId()
    })
  ),
  Rpc.effect(CheckHandle, ({ handle }) =>
    Effect.gen(function* () {
      const saiService = yield* SaiService
      return yield* saiService.checkHandle(handle)
    })
  ),
  Rpc.effect(BootstrapAccount, ({ handle }) =>
    Effect.gen(function* () {
      const saiService = yield* SaiService
      return yield* saiService.bootstrapAccount(handle)
    })
  ),
  Rpc.effect(RegisterPushSubscription, ({ subscription }) =>
    Effect.gen(function* () {
      const saiService = yield* SaiService
      return yield* saiService.registerPushSubscription(subscription)
    })
  ),
  Rpc.effect(ListApplications, ({ context }) =>
    Effect.gen(function* () {
      const saiService = yield* SaiService
      return yield* saiService.getApplications(context)
    })
  ),
  Rpc.effect(GetUnregisteredApplication, ({ id }) =>
    Effect.gen(function* () {
      const saiService = yield* SaiService
      return yield* saiService.getUnregisteredApplication(id)
    })
  ),
  Rpc.effect(GetAuthoriaztionData, ({ agentId, agentType, lang, accessNeedGroupIri, context }) =>
    Effect.gen(function* () {
      const saiService = yield* SaiService
      return yield* saiService.getAuthorizationData(agentId, agentType, lang, accessNeedGroupIri, context)
    })
  ),
  Rpc.effect(GetResource, ({ id, lang, context }) =>
    Effect.gen(function* () {
      const saiService = yield* SaiService
      return yield* saiService.getResource(id, lang, context)
    })
  ),
  Rpc.effect(ListSocialAgents, ({ context }) =>
    Effect.gen(function* () {
      const saiService = yield* SaiService
      return yield* saiService.getSocialAgents(context)
    })
  ),
  Rpc.effect(ListSocialAgentInvitations, ({ context }) =>
    Effect.gen(function* () {
      const saiService = yield* SaiService
      return yield* saiService.getSocialAgentInvitations(context)
    })
  ),
  Rpc.effect(ListRoles, ({ context }) =>
    Effect.gen(function* () {
      const saiService = yield* SaiService
      return yield* saiService.getRoles(context)
    })
  ),
  Rpc.effect(CreateRole, ({ label, members, context }) =>
    Effect.gen(function* () {
      const saiService = yield* SaiService
      return yield* saiService.createRole(label, members, context)
    })
  ),
  Rpc.effect(UpdateRole, ({ id, label, members, context }) =>
    Effect.gen(function* () {
      const saiService = yield* SaiService
      return yield* saiService.updateRole(id, label, members, context)
    })
  ),
  Rpc.effect(DeleteRole, ({ id, context }) =>
    Effect.gen(function* () {
      const saiService = yield* SaiService
      return yield* saiService.deleteRole(id, context)
    })
  ),
  Rpc.effect(ListDataRegistries, ({ agentId, lang, context }) =>
    Effect.gen(function* () {
      const saiService = yield* SaiService
      return yield* saiService.getDataRegistries(agentId, lang, context)
    })
  ),
  Rpc.effect(ListDataInstances, ({ agentId, registrationId, context }) =>
    Effect.gen(function* () {
      const saiService = yield* SaiService
      return yield* saiService.listDataInstances(agentId, registrationId, context)
    })
  ),
  Rpc.effect(
    RequestAccessUsingApplicationNeeds,
    ({ applicationId, agentId, context }) =>
      Effect.gen(function* () {
        const saiService = yield* SaiService
        return yield* saiService.requestAccessUsingApplicationNeeds(applicationId, agentId, context)
      })
  ),
  Rpc.effect(CreateInvitation, ({ label, note, context }) =>
    Effect.gen(function* () {
      const saiService = yield* SaiService
      return yield* saiService.createInvitation(label, note, context)
    })
  ),
  Rpc.effect(AcceptInvitation, ({ capabilityUrl, label, note, context }) =>
    Effect.gen(function* () {
      const saiService = yield* SaiService
      return yield* saiService.acceptInvitation(capabilityUrl, label, note, context)
    })
  ),
  Rpc.effect(ShareResource, ({ authorization, context }) =>
    Effect.gen(function* () {
      const saiService = yield* SaiService
      return yield* saiService.shareResource(authorization, context)
    })
  ),
  Rpc.effect(AuthorizeApp, ({ authorization, context }) =>
    Effect.gen(function* () {
      const saiService = yield* SaiService
      return yield* saiService.authorizeApp(authorization, context)
    })
  ),
  Rpc.effect(RevokeGrants, ({ grants, context }) =>
    Effect.gen(function* () {
      const saiService = yield* SaiService
      return yield* saiService.revokeGrants(grants, context)
    })
  ),
  Rpc.effect(AddAdmin, ({ webId, context }) =>
    Effect.gen(function* () {
      const saiService = yield* SaiService
      return yield* saiService.addAdmin(webId, context)
    })
  ),
  Rpc.effect(RemoveAdmin, ({ webId, context }) =>
    Effect.gen(function* () {
      const saiService = yield* SaiService
      return yield* saiService.removeAdmin(webId, context)
    })
  )
)

export type UiRpcRouter = typeof router
