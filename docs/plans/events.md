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
  `roleDeleted`, `agentRegistrationAdded`, `invitationAccepted`,
  `invitationCreated`, `delegatedGrantsUpdated`, `grantsRevoked` → matching
  Temporal workflow on its task queue;
- completions (`activityCompleted`) never dispatch, only forward.

## Existing activity types

| activityType | Producer | Consumer |
|---|---|---|
| `authorizationRecorded` | `services/Authorization.ts`, `services/ShareResource.ts` | per-grantee consumer (`processGranteeActivities`) |
| `authorizationRevoked` | deny path (see `authorization-revoked.md`, not yet landed) | per-grantee consumer |
| `roleMembershipChanged` | `services/RoleRegistry.ts` — **activity-only (step 2)**: the RPC writes the intended change (object = the role-to-be `RoleData`); the `updateRole` workflow PATCHes the role, derives the affected diff, regenerates grants | `processRoleMembershipChange` (workflow, `create-grants` queue) |
| `roleDeleted` | `services/RoleRegistry.ts` (synchronous DELETE until step 3) | `processRoleDeletion` |
| `agentRegistrationAdded` | `InvitationHandler.ts` | `establishReciprocal` |
| `invitationAccepted` | `acceptInvitation` service (acceptor's Activity Registry — own or org) | `acceptInvitation` (acceptor's workflow) |
| `invitationCreated` | `createInvitation` RPC (activity-only — step 1; the workflow PUTs the invitation and generates the capabilityUrl there) | `createInvitation` (workflow, `create-grants` queue) |
| `delegatedGrantsUpdated` | `ReciprocalWebhookHandler.ts` | `updateDelegatedGrants` |
| `grantsRevoked` | revocation boundary (`revoke-delegation-chain.md`) | `processGrantsRevocation` |
| `activityCompleted` | Temporal completions | — (forwarding only) |

## New: admin event (org-admin Phase 1)

The `AddAdmin` / `RemoveAdmin` RPC records the change and writes a **domain
activity** to the org's Activity Registry; `ActivityWebhookHandler` routes it to
**parallel workflows** that materialize the side effects (grants + ACR
matchers). Shape (decided — `RemoveAdmin` has its own distinct activity, no
`granted`-flag reuse). Activities are **typed classes** since the
payload-contract flip (`webId` → `actor`, parties ride the `as:object`):

```
type:   ['Activity', 'AdminAuthorizationRecorded']          (`AddAdmin`)
      / ['Activity', 'AdminAuthorizationRevoked']           (`RemoveAdmin`)
as:actor:  the org webId (the registry owner)
as:target: the org's AuthorizationRegistry
as:object: <AdminAuthorization IRI>    // the admin's grantee is read from it
```

Add vs. remove is distinguished by the `activityType` itself (mirroring the
`authorizationRecorded` / `authorizationRevoked` pair).

- **Producer:** `AddAdmin`/`RemoveAdmin` RPC service (`services/Admin.ts`):
  the RPC changes the org's AuthorizationRegistry **synchronously** — create
  the `AdminAuthorization` on add, delete it on revoke (mirroring
  `recordAuthorization` / `deleteRole`; error on already-admin / non-admin) —
  then writes the activity via `ActivityRegistry.createActivity`.
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