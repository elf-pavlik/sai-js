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
  `roleDeleted`, `agentRegistrationAdded`, `delegatedGrantsUpdated`,
  `grantsRevoked` → matching Temporal workflow on its task queue;
- completions (`activityCompleted`) never dispatch, only forward.

## Existing activity types

| activityType | Producer | Consumer |
|---|---|---|
| `authorizationRecorded` | `services/Authorization.ts`, `services/ShareResource.ts` | per-grantee consumer (`processGranteeActivities`) |
| `authorizationRevoked` | deny path (see `authorization-revoked.md`, not yet landed) | per-grantee consumer |
| `roleMembershipChanged` / `roleDeleted` | `services/RoleRegistry.ts` | `processRoleMembershipChange` / `processRoleDeletion` |
| `agentRegistrationAdded` | `InvitationHandler.ts` | `establishReciprocal` |
| `delegatedGrantsUpdated` | `ReciprocalWebhookHandler.ts` | `updateDelegatedGrants` |
| `grantsRevoked` | revocation boundary (`revoke-delegation-chain.md`) | `processGrantsRevocation` |
| `activityCompleted` | Temporal completions | — (forwarding only) |

## New: admin event (org-admin Phase 1)

The `AddAdmin` / `RemoveAdmin` RPC records the change and writes a **domain
activity** to the org's Activity Registry; `ActivityWebhookHandler` routes it to
**parallel workflows** that materialize the side effects (grants + ACR
matchers). Proposed shape — final naming/fields to settle during Phase 1:

```
activityType: adminAuthorizationRecorded     (reuse for add and remove, or split — see below)
target:      the org's AuthorizationRegistry (or RegistrySet)
payload:     {
               webId:   { id: <org webId>, type: [interop:SocialAgent] },  // event owner
               admin:   { id: <admin webId>, type: [interop:SocialAgent] },
               granted: <boolean>                                          // true = add, false = remove
             }
```

- **Producer:** `AddAdmin`/`RemoveAdmin` RPC service (`services/Admin.ts`),
  after recording the `AdminAuthorization` into the org's AuthorizationRegistry,
  via `ActivityRegistry.createActivity`.
- **Handler:** a new branch in `ActivityWebhookHandler` (parallel to
  `GRANTEE_ACTIVITY_TYPES` / `activityWorkflows`). The trigger is **shared**;
  the workflows **diverge after the trigger**:
  1. `createAdminGrants` — generate AdminGrants from the AdminAuthorization:
     one `scopeOfAdminGrant interop:RegistrySet` (the registration-linked admin
     marker) + one `interop:DataRegistry` per data registry in the RegistrySet
     (Read-only, for the engine);
  2. `syncAdminAcr` — rewrite the org's `#fullAdminAccess` matchers in the
     registries-server ACR from the admin list (derived artifact, idempotent
     rewrite rather than incremental patch).
  The activity payload can be adjusted as needed to feed both.
- **Parallelism note (decided):** two workflows, same task queue family
  (`create-grants`) or a dedicated queue; they may be started from the one
  activity (two starts) or from one fan-out workflow via `executeChild` —
  settle during implementation.

## Marked TODO / future domain events

- **New data registry added to a RegistrySet.** A `RegistrySet`-scope admin
  authorization (`interop:All`) must expand to a *new* `DataRegistry` admin
  grant when the org gains a data registry. No producer exists yet; design a
  `dataRegistryAdded`-style event (or fold into the existing admin
  regeneration) when registry-set mutation is implemented. **TODO — not part of
  Phase 1.**
- **Admin removal event.** Decide during Phase 1 whether `RemoveAdmin` reuses
  `adminAuthorizationRecorded` with `granted: false` or writes a distinct
  `adminAuthorizationRevoked` (mirroring the `authorizationRevoked` precedent);
  the revocation boundary (`GrantRevocationHandler`) should also handle admin
  revocation and the last-admin guard.
- **Admin-authorization iteration is deferred** (see `org-admin-feature.md`
  R1): no `adminAuthorizations()` listing API until the consuming functionality
  is planned. The workflows must still read admin state (source of truth: the
  org's AuthorizationRegistry, type-filtered); only the public iteration
  surface is deferred.

## Relationship to Phase 2/3 events

- **Reciprocal registration updates** (admin flag change observed by the admin's
  own server) keep using `delegatedGrantsUpdated` (`ReciprocalWebhookHandler`)
  — unchanged, deliberate dual-cause reuse per `org-admin-feature.md` §2.5/§2.8.
- **Phase 3 admin event forwarding:** admin UI learns about org-context
  workflow outcomes; events are keyed by the admin's webId. The events above
  land in the **org's** Activity Registry and are processed by the org's AA;
  forwarding to the admin's stream is Phase 3 (`ActivityWebhookHandler` reuse,
  §3 of `org-admin-feature.md`).