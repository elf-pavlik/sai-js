# Domain events (activity outbox)

> **Status:** design notes. Catalogues the domain events (Activity Registry
> `activityType`s) that drive the Temporal workflows via `ActivityWebhookHandler`
> — the model landed in `workflow-temporal-decupling.md` — and specifies the
> **new admin event** introduced by `org-admin-feature.md` Phase 1, plus the
> events we know we will need but are deferring.

## Model recap

Producers write typed activities into the **org's Activity Registry** (single
PATCH / immutable append, `immutable-activities.md`). `ActivityWebhookHandler`
receives the webhook `Add`, loads the activity, forwards it to the events bus
(keyed by the channel's webId), and dispatches:

- **per-grantee consumer** (`GRANTEE_ACTIVITY_TYPES`): `authorizationRecorded`,
  `authorizationRevoked` → `processGranteeActivities` (start-or-signal, one
  consumer per (webId, grantee));
- **one workflow per type** (`activityWorkflows` map): `roleMembershipChanged`,
  `roleDeleted`, `roleCreated`, `agentRegistrationAdded`, `invitationAccepted`,
  `invitationCreated`, `delegatedGrantsUpdated` → matching
  Temporal workflow on its task queue;
- completions (`activityCompleted`) never dispatch, only forward.

## Existing activity types

| activityType | Producer | Consumer |
|---|---|---|
| `authorizationRecorded` | `services/Authorization.ts`, `services/ShareResource.ts` | per-grantee consumer (`processGranteeActivities`) |
| `authorizationRevoked` | deny path (see `authorization-revoked.md`, not yet landed) | per-grantee consumer |
| `roleMembershipChanged` | `services/RoleRegistry.ts` — **activity-only (step 2)**: the RPC writes the intended change (object = the role-to-be `RoleData`); the `updateRole` workflow PATCHes the role, derives the affected diff, regenerates grants | `processRoleMembershipChange` (workflow, `create-grants` queue) |
| `roleDeleted` | `services/RoleRegistry.ts` — **activity-only (step 3)**: the RPC writes the role-to-be-deleted (object = the real-id embedded `RoleData`); the `deleteRole` workflow DELETEs the role + its authorizations and regenerates grants | `processRoleDeletion` (workflow, `create-grants` queue) |
| `roleCreated` | `services/RoleRegistry.ts` — **activity-only (step 9)**: the RPC mints the role id + writes the role-to-be (object = the real-id embedded `RoleData` at the minted id); the `createRole` workflow PUTs the role there and completes (no derived work — the PUT is the create) | `createRole` (workflow, `create-grants` queue) |
| `agentRegistrationAdded` | `InvitationHandler.ts` | `establishReciprocal` |
| `invitationAccepted` | `acceptInvitation` service (acceptor's Activity Registry — own or org) | `acceptInvitation` (acceptor's workflow) |
| `invitationCreated` | `createInvitation` RPC (activity-only — step 1; the workflow PUTs the invitation and generates the capabilityUrl there) | `createInvitation` (workflow, `create-grants` queue) |
| `delegatedGrantsUpdated` | `ReciprocalWebhookHandler.ts` | `updateDelegatedGrants` |
| `grantsRevoked` | **retired by the activity-first cleanup (step 4 — executed)**: dormant (no producer); grants are only revoked via the **issuance endpoint** and **from workflows** (`revoke-delegation-chain.md`); the authorization-revocation leg lives in [`authorization-revocation.md`](authorization-revocation.md) | — (wiring retired with the class) |
| `activityCompleted` | Temporal completions | — (forwarding only) |

## New: admin event (org-admin Phase 1 + activity-first step 5)

The `AddAdmin` / `RemoveAdmin` RPC writes a **domain activity** to the org's
Activity Registry; `ActivityWebhookHandler` routes it to workflows that
materialize the side effects (AdminAuthorization write/delete, grants + ACR
matchers). `AddAdmin` is **activity-first (step 5 — R1 re-decision)**: the RPC
keeps the validation reads and pre-mints the AdminAuthorization id; the
`addAdmin` workflow PUTs the resource, then grants + ACR. `RemoveAdmin` still
records/deletes synchronously until step 6. Activities are **typed classes**
(the payload-contract flip: `webId` → `actor`, parties ride the `as:object`):

```
type:   ['Activity', 'AdminAuthorizationGranted']          (`AddAdmin` — step 5)
      / ['Activity', 'AdminAuthorizationRevoked']           (`RemoveAdmin` — until step 6)
as:actor:  the org webId (the registry owner)
as:target: (dropped — steps 5–6; the records' ids ride `object.id`)
as:object: (recorded: the AA-to-be at the PRE-MINTED id; revoked: the
            existing AA at its real id — both real-id embedded projections) —
            the admin's grantee is read from it in both forms
```

Add vs. remove is distinguished by the `activityType` itself (mirroring the
`authorizationRecorded` / `authorizationRevoked` pair).

- **Producer:** `AddAdmin`/`RemoveAdmin` RPC service (`services/Admin.ts`):
  add — validation reads (registered + already-admin) + pre-mint the
  AdminAuthorization id + write the activity only (the workflow PUTs the
  resource at the pre-minted id); revoke — validation reads (registered +
  admin-exists + **last-admin guard**, RPC-time errors preserved) + write the
  activity only (the workflow DELETEs the resource at `object.id`).
- **Handler:** a new branch in `ActivityWebhookHandler` (parallel to
  `GRANTEE_ACTIVITY_TYPES` / `activityWorkflows`). The **trigger is the shared
  activity pair**; add and remove are distinguished by `activityType`
  (decided — distinct shapes, no `granted` flag), and the workflows **diverge
  after the trigger**:
  - `adminAuthorizationRecorded` → `createAdminGrants` (from the
    AdminAuthorization: one `scopeOfAdminGrant interop:RegistrySet`
    registration-linked admin marker + one `interop:DataRegistry` per data
    registry in the RegistrySet, Read-only, for the engine) + `syncAdminAcr`;
  - `adminAuthorizationRevoked` → `revokeAdminGrants` (delete the admin's
    AdminGrants, unlink `hasAdminGrant`, remove their ACRs) + `syncAdminAcr`.
  `syncAdminAcr` — rewrite the org's `#fullAdminAccess` matchers in the
  registries-server ACR from the admin list (derived artifact, idempotent
  rewrite rather than incremental patch) — runs on both, reading the
  AuthorizationRegistry as source of truth (last-admin guard).
- **Parallelism note (decided):** two workflows per activity, same task queue
  family (`create-grants`) or a dedicated queue; they may be started from the
  one activity (two starts) or from one fan-out workflow via `executeChild` —
  settle during implementation.

## Marked TODO / future domain events

- **New data registry added to a RegistrySet.** A `RegistrySet`-scope admin
  authorization (`interop:All`) must expand to a *new* `DataRegistry` admin
  grant when the org gains a data registry. No producer exists yet; design a
  `dataRegistryAdded`-style event (or fold into the existing admin
  regeneration) when registry-set mutation is implemented. **TODO — not part of
  Phase 1.**
- **Admin removal event (decided).** `RemoveAdmin` writes a **distinct**
  `adminAuthorizationRevoked` activity (own shape; no `granted: false` reuse of
  `adminAuthorizationRecorded`), mirroring the `authorizationRevoked`
  precedent. The revocation boundary (`GrantRevocationHandler`) should also
  handle admin revocation (`revokeAdminGrants`) and the last-admin guard.
- **Admin-authorization iteration is deferred** (see `org-admin-feature.md`
  R1): no `adminAuthorizations()` listing API until the consuming functionality
  is planned. The workflows must still read admin state (source of truth: the
  org's AuthorizationRegistry, type-filtered); only the public iteration
  surface is deferred.

## Relationship to Phase 2/3 events

- **Reciprocal registration updates** (admin flag change observed by the admin's
  own server) keep using `delegatedGrantsUpdated` (`ReciprocalWebhookHandler`)
  — unchanged, deliberate dual-cause reuse per `org-admin-feature.md` §2.5/§2.8.
- **Phase 3 admin event forwarding (R3, decided):** admin UI learns about
  org-context workflow outcomes on its **existing** stream — one webhook
  channel per (admin, org) on the org's Activity Registry, `webId` = the
  admin, recognized by the same `ActivityWebhookHandler` (owner check) and
  forwarded keyed by the admin's webId; no workflow dispatch on admin
  channels (the org's owner channel + AA keep running the workflows).
  Supplements — does not replace — the `delegatedGrantsUpdated` reciprocal
  refresh above. Dev/test seed the channels in `environments/data/kv.json`;
  real deployments create/remove them with the admin-grant lifecycle
  (`webhook-subscription-bootstrap.md` §4.6).