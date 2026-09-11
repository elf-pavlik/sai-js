# SAI features — activities, triggers, workflows, views

> **Scope.** A catalogue of the SAI **domain activities/events** (the Activity
> Registry outbox), where each is **triggered** (UI → RPC, another webhook, a
> workflow), the **Temporal workflow** it dispatches, who may trigger it
> (**data owner vs org admin**), and which **`docs/temporal.c4` dynamic view**
> covers it.
>
> **Sources of truth:** `packages/data-model/src/activities.ts` (class union),
> `packages/components/src/ActivityWebhookHandler.ts` (dispatch),
> `packages/components/src/services/*` + `*Handler.ts` (producers),
> `docs/temporal.c4` (views), `docs/plans/events.md` (design catalogue).
>
> **Status legend:** ✅ implemented · ⚠️ partial (RPC writes state synchronously,
> then activity drives derived work) · 🧪 planned / producer not landed ·
> 💤 candidate (type exists, no producer).

## 1. Model in one paragraph

A **producer** appends a typed `Activity` to a **context's Activity Registry**
(personal = the user, org = the org). A webhook `Add` reaches
`ActivityWebhookHandler`, which (a) **forwards** the activity to the events bus
keyed by the channel's webId (`pending`), and (b) — only on the **owner
channel** (`isRegistryOwner`) — dispatches a **Temporal workflow**. A workflow
ends by writing `ActivityCompleted`, which is forwarded as `done`. Admin
channels are **forward-only** (no dispatch). `reconcileActivities` is the
missed-delivery backstop (same routing).

## 2. Activities / events

| Activity class | Status | Trigger source | Producer | Workflow(s) dispatched |
|---|---|---|---|---|
| `InvitationCreated` | ✅ | **UI → RPC** | `createInvitation` (`services/InvitationRegistry.ts`) | `createInvitation` |
| `InvitationAccepted` | ✅ | **UI → RPC** | `acceptInvitation` (`services/SocialAgentRegistry.ts`) | `acceptInvitation` |
| `AgentRegistrationAdded` | ✅ | **other endpoint** (invitee's `POST capabilityUrl` → inviter AA) | `InvitationHandler` | `establishReciprocal` |
| `NeedBasedAccessRequestSent` | ✅ | **UI → RPC** | `requestAccessUsing*` (`services/ShareResource.ts`) | `processNeedBasedAccessRequest` |
| `NeedBasedAccessRequestReceived` | ✅ | **other endpoint** (requester workflow `POST issuanceUrl` → owner AA) | `GrantIssuanceHandler` | `processNeedBasedAccessRequestReceived` |
| `RoleCreated` | ✅ | **UI → RPC** | `createRole` (`services/RoleRegistry.ts`) | `createRole` |
| `RoleMembershipChanged` | ✅ | **UI → RPC** | `updateRole` (`services/RoleRegistry.ts`) | `processRoleMembershipChange` |
| `RoleDeleted` | ✅ | **UI → RPC** | `deleteRole` (`services/RoleRegistry.ts`) | `processRoleDeletion` |
| `AdminAuthorizationGranted` | ✅ | **UI → RPC** | `addAdmin` (`services/Admin.ts`) | `processAdminAuthorizationGranted` → (`createAdminGrants` + `syncAdminAcr`) |
| `AdminAuthorizationRevoked` | ✅ | **UI → RPC** | `removeAdmin` (`services/Admin.ts`) | `processAdminAuthorizationRevoked` → (`revokeAdminGrants` + `syncAdminAcr`) |
| `AuthorizationGranted` | ✅ | **UI → RPC** | `recordAuthorization` (`AuthorizeApp` — grant) and `shareResource` (`services/Authorization.ts`, `services/ShareResource.ts`) | `processAuthorizationGranted` → per-grantee `processGranteeAuthorization` children (dedicated parent + fan-out) |
| `AuthorizationDenied` | ✅ | **UI → RPC** | `recordAuthorization` (`AuthorizeApp` — decline; a pure decline — no delete, no grant clear) | — forward-only (Step 4): no workflow; the reconcile sweep marks it done |
| `AuthorizationRevoked` | 🧪 | **UI → RPC** (planned) | *none yet* (`authorization-revocation.md`) | `processGranteeActivities` (routing ready) |
| `DelegatedGrantsUpdated` | ✅ | **other webhook** (peer's reciprocal-registration `Update`) | `ReciprocalWebhookHandler` | `updateDelegatedGrants` |
| `ActivityCompleted` | ✅ | **workflow** (completion, not user action) | `markActivitiesDone` / `createCompletion` | — (forward-only) |
| `grantsRevoked` | 🗑️ retired | — | — (no producer; dormant wiring removed) | — |

Task queues (set at dispatch): most workflows → **`create-grants`**; invitation
accept + reciprocal → **`reciprocal-registration`**; push → **`forward-to-push`**.

> [!NOTE] Silent deny (decided 2026-09)
> A declined request is **silent**: `AuthorizationDenied` (landed —
> `plans/authorization-granting.md` Step 4) is forward-only — audit/stream
> only, no requester notification, no grant regeneration. May be reevaluated
> if requester-side denial UX is ever needed (plans §11.3).

> [!NOTE] Outcome confirmation reaches the requester via the registration
> webhook
> When the owner grants request-initiated access, the grantee learns the
> outcome through the **existing webhook path**, not a dedicated activity:
> the grantor-side (reciprocal) registration `Update` →
> `ReciprocalWebhookHandler` → `delegatedGrantsUpdated` →
> `updateDelegatedGrants` mirror sync → UI refresh. Correlation identifier:
> `DataAuthorization.satisfiesAccessNeed` links the authorization to the
> access need it was granted on. **Caveat:** the derived `DataGrant` does
> **not** carry `satisfiesAccessNeed` (`packages/data-model/src/grant.ts`) —
> the grantee's mirrored grants cannot resolve the requesting need directly;
> either correlate on `registeredShapeTree`/`scopeOfGrant`/`hasDataInstance`,
> or add the link at grant level (open).

> [!NOTE] Grant-level vs authorization-level (boundary)
> The delegation `AccessRequest` / `AccessRevocation` messages
> (`GrantIssuanceHandler` / `GrantRevocationHandler`) are a **grant-level**
> feature (delegated grants between agents/registries) — **not** Activity
> Registry events, outside this table, distinct from the authorization-level
> `NeedBasedAccessRequest` although both are "access requests".

## 3. Trigger classification

### A. Triggered from the UI over RPC (`services/*`, via `ApiHandler`)

`InvitationCreated`, `InvitationAccepted`, `NeedBasedAccessRequestSent`,
`RoleCreated`, `RoleMembershipChanged`, `RoleDeleted`,
`AdminAuthorizationGranted`, `AdminAuthorizationRevoked`,
`AuthorizationGranted` (record + share), `AuthorizationDenied` (decline), and
planned `AuthorizationRevoked`.

### B. Triggered from other endpoints / webhooks / activities (not `services/`)

- **`AgentRegistrationAdded`** — `InvitationHandler`, invoked by the acceptor's
  `acceptInvitation` workflow `POST`ing the capabilityUrl to the inviter's AA.
- **`NeedBasedAccessRequestReceived`** — `GrantIssuanceHandler`, invoked by the
  requester's workflow `POST`ing to the owner's reused issuance endpoint.
- **`DelegatedGrantsUpdated`** — `ReciprocalWebhookHandler`, driven by the
  **peer's** reciprocal-registration `Update` webhook.
- **`ActivityCompleted`** — written by **workflows** themselves (Temporal
  completion), never user-triggered.

## 4. Admin vs data owner

Contexts: **personal** (the signed-in user's own webId — always allowed) or
**org** (a webId the user administers — allowed only if the user's registration
in the org carries the admin marker).

| Capability | Who |
|---|---|
| `GetWebId`, `CheckHandle`, `BootstrapAccount`, `RegisterPushSubscription` | **Personal only** (no context param) |
| Admin-only `Link: … rel="interop:hasRegistrySet"` (org registry-set discovery) | **Org admin only** |
| Everything else (`CreateInvitation`, `AcceptInvitation`, `AddAdmin`, `RemoveAdmin`, `CreateRole`, `UpdateRole`, `DeleteRole`, `AuthorizeApp`, `ShareResource`, `RequestAccessUsing*`, `RevokeGrants`, all `List*` reads) | **Data owner** in personal context **or** **org admin** in org context — same RPC, owner identity switches to the org (`ctx.webId`), target registries switch to the org's |

In an org context the admin acts **as** the org (the org is `dataOwner`/`grantedBy`
and the ACR owner); the user only authenticates. So there is no operation that
is owner-but-not-admin within an org — the gate to an org context *is* the admin
marker. `AddAdmin`/`RemoveAdmin` follow the same rule — run by the **data owner**
in a personal context and by the **org admin** in an org context; the
last-admin guard still prevents an org from ending up admin-less.

## 5. Coverage of `docs/temporal.c4` dynamic views

`temporal.c4` has **16 dynamic views**. Views are **not** all `variant sequence`,
but each is an interaction/sequence diagram (LikeC4 dynamic view). Organised by
the `/`-grouped titles:

- 👤 **User** — personal context (the signed-in user's own webId)
- 🏢 **Organization** — org context (a webId the user administers)

### Discovery

| View | Test |
|---|---|
| `application-registration-discovery` | `agent-discovery.test.ts` — 'responds with application registry in headers' |
| `social-agent-registration-discovery` | `agent-discovery.test.ts` — 'responds with social agent registry in headers' |
| 🏢 `org-registry-set-discovery` | `org-context.test.ts` — 'registry-set resolution (2.3)' |

> [!NOTE] Agent registration discovery (application & social agent) is
> context-agnostic — the admin plays no role, so the 👤/🏢 distinction does
> not apply; only the org registry-set discovery is admin-gated.

### Admin

| View | Test |
|---|---|
| 🏢 `org-admin-add` | `admin-events.test.ts` — 'the admin receives org-context admin activities (pending + done)' |
| 🏢 `org-admin-remove` | `admin-events.test.ts` — 'demotion removes the admin from the ACR while keeping the remaining admin' |
| 👤 `org-admin-add` (personal) 🧪 | |
| 👤 `org-admin-remove` (personal) 🧪 | |

### Invitation

| View | Test |
|---|---|
| 👤 `invitation` | `invitation.test.ts` — 'personal invitation' |
| 🏢 `admin-invitation-send` | `invitation.test.ts` — 'admin invitation send' |
| 🏢 `admin-invitation-receive` | `invitation.test.ts` — 'admin invitation receive' |

### Roles

| View | Test |
|---|---|
| 👤 `role-membership-change` | `roles.test.ts` — 'update role chums remove kim add bob' (grant created when kim added / revoked when removed) |
| 👤 `role-deletion` | `roles.test.ts` — 'delete role test' |
| 🏢 `role-membership-change` (org) 🧪 | |
| 🏢 `role-deletion` (org) 🧪 | |
| 👤 `role-created` 🧪 | |
| 🏢 `role-created` (org) 🧪 | |

### Authorization

| View | Test |
|---|---|
| 👤 `authorization` (AuthorizeApp) | `authorization.test.ts` — 'creates denied authorization' (grant leg + silent decline) |
| 👤 `authorization-data-app` | `authorization.test.ts` — 'responds with authorization data' |
| 👤 `authz-data-need-based-request` (reads) | `authorization.test.ts` — 'approve a need-based access request' |
| 👤 `share-resource` | `share.test.ts` — 'shares a data instance with a social agent' |
| 👤 `request-access` | `access-request.test.ts` — 'request access (sent side)' + '(receive side)' |
| 🏢 `authorization` (org) 🧪 | |
| 🏢 `authorization-data-app` (org) 🧪 | |
| 🏢 `authz-data-need-based-request` (org) 🧪 | |
| 🏢 `share-resource` (org) 🧪 | |
| 🏢 `request-access` (org) 🧪 | |

### Reciprocal

| View | Test |
|---|---|
| `reciprocal-registration-update` | `reciprocal-webhook.test.ts` — 'id' + 'emits pending and done events for the delegatedGrantsUpdated activity' |

> [!NOTE] The reciprocal registration update is driven by the peer's webhook —
> the admin plays no role, so the 👤/🏢 distinction does not apply.

### Activity → view map

| Activity | View(s) |
|---|---|
| `InvitationCreated` | `invitation`, `admin-invitation-send` |
| `InvitationAccepted` | `invitation`, `admin-invitation-send`, `admin-invitation-receive` |
| `AgentRegistrationAdded` | `invitation`, `admin-invitation-send`, `admin-invitation-receive` |
| `NeedBasedAccessRequestSent` / `Received` | `request-access` |
| `RoleMembershipChanged` | `role-membership-change` |
| `RoleDeleted` | `role-deletion` |
| `RoleCreated` | — |
| `AdminAuthorizationGranted` | `org-admin-add` |
| `AdminAuthorizationRevoked` | `org-admin-remove` |
| `AuthorizationGranted` | `authorization` (record), `share-resource` (share) |
| `AuthorizationDenied` | — |
| `AuthorizationRevoked` | — |
| `DelegatedGrantsUpdated` | `reciprocal-registration-update` |
| `ActivityCompleted` | shown as a step in most views |

**Read-only / discovery legs** (not activities): `authorization-data-app`,
`authz-data-need-based-request`, and the three Discovery views.

**Missing views to add:** `roleCreated` creation; `AuthorizationRevoked` (when
landed). `AuthorizationDenied` stays view-less — a silent decline, forward-only,
and `ActivityCompleted` is only ever an internal completion step inside other
views. (`authorization` + `share-resource` were refreshed to the
activity-first granting shape — dedicated parent + per-grantee fan-out.)

## 6. Event → workflow summary

| Event | Workflow | Queue |
|---|---|---|
| `InvitationCreated` | `createInvitation` | `create-grants` |
| `InvitationAccepted` | `acceptInvitation` | `reciprocal-registration` |
| `AgentRegistrationAdded` | `establishReciprocal` | `reciprocal-registration` |
| `AuthorizationGranted` | `processAuthorizationGranted` (parent) → `processGranteeAuthorization` (per-grantee children) | `create-grants` |
| `AuthorizationDenied` | — (forward-only; the reconcile sweep marks it done) | — |
| `AuthorizationRevoked` | `processGranteeActivities` (start-or-signal, `grantee:<webId>:<grantee>`) — no producer yet | `create-grants` |
| `RoleCreated` | `createRole` | `create-grants` |
| `RoleMembershipChanged` | `processRoleMembershipChange` | `create-grants` |
| `RoleDeleted` | `processRoleDeletion` | `create-grants` |
| `AdminAuthorizationGranted` | `processAdminAuthorizationGranted` → `createAdminGrants` + `syncAdminAcr` | `create-grants` |
| `AdminAuthorizationRevoked` | `processAdminAuthorizationRevoked` → `revokeAdminGrants` + `syncAdminAcr` | `create-grants` |
| `DelegatedGrantsUpdated` | `updateDelegatedGrants` | `create-grants` |
| `NeedBasedAccessRequestSent` | `processNeedBasedAccessRequest` | `create-grants` |
| `NeedBasedAccessRequestReceived` | `processNeedBasedAccessRequestReceived` | `create-grants` |
| `ActivityCompleted` | — (forward-only) | — |
