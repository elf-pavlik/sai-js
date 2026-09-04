# Activity-first services — move mutation processing from `services/` to `temporal/`

> **Status: step 0's mechanism + step 1 EXECUTED** — the `createInvitation`
> send leg is activity-first (the `InvitationCreated` form); the step-0
> activity indicator (store tracker + claims + app-shell snackbar +
> `ACTIVITY_LABELS` map) is built and verified via the create flow; and
> **both invitation legs (accept + inviter `establishReciprocal`) are aligned
> to the same template** (typed activity refs, verbatim object passthrough,
> `target` dropped, mint-in-service handler + workflow materializes).
> `/test` invitation suites green (user-run).
> **Latest (step 0 completed):** the pending acks now echo the triggering
> **activity id** (`createActivity` already returns it — previously
> discarded) — the uniform UI claim anchor; both store claims (create +
> accept) bind the stream event by the echoed `activityId` (exact match, no
> cross-binding; the accept's urn:uuid snapshot object needs no UI-known
> id).
> **Latest (step 2 — `updateRole`, POJO-first reorder):** role updates are
> activity-first — `RoleMembershipChanged` re-pinned to the InvitationCreated
> template (`target` dropped, `object` = the role-to-be `RoleData`, `as:Update`);
> the RPC keeps a read-side existence guard + writes the activity + returns a
> pending ack (role-to-be + `activityId`); the `updateRole` workflow PATCHes
> the role (`updateRoleInRegistry`, find-first idempotent) → derives the
> affected diff from the before-image → regenerates → completes. Structure
> activities (`recordAuthorization`, `shareResource`) moved to the end (§7).
> **Latest (step 3 — `deleteRole`):** role deletions are activity-first —
> `RoleDeleted` re-pinned the same way (`target` dropped, `object` = the
> role-to-be-deleted as a real-id embedded `RoleData`, the write-time
> snapshot = the retry backstop once the role is gone); the RPC keeps a
> guard read + writes the activity + returns `RoleDeletedMessage` (deleted
> role id + `activityId`); the `deleteRole` workflow scans usage BEFORE the
> deletions, deleteAuthorizations, DELETEs the role (`deleteRoleFromRegistry`,
> find-first 404-tolerant), derives the affected set from the embedded
> members, regenerates, completes.
> **Next:** step 4 `revokeGrants`.
> Packages vitest + build + vue-tsc green (agent-run); `/test` suites
> (roles/invitation) pending user run.
> Extends the
> established "RPC records a domain activity → `ActivityWebhookHandler`
> dispatches a workflow that materializes the state" model (`events.md`,
> `workflow-temporal-decupling.md`, `org-admin-feature.md`,
> `org-context-improvements.md`). Reference for the target topology:
> `invitation`, `admin-invitation-send`, `admin-invitation-receive` in
> `docs/temporal.c4` (the three up-to-date views).
>
> **⚠️ Prerequisite: [`payload-contract-alignment.md`](payload-contract-alignment.md)**
> — the activity **class** types (`ActivityData` as a `type`-discriminated
> union, flat interfaces, `ActivityRef` target), their `api-messages` Schema
> projections, the typed dispatch boundary, the `webId` → `{ id, type }`
> unification, and the `iri` → `id` rename land **before** step 1 of this
> plan (this plan's §6.10 is a pointer; step 0's backend half lives there).
>
> **Goal.** The admin (user acting in any context) modifies the system by
> **adding an activity to the Activity Registry**; the webhook notification
> dispatches a **specific workflow** that performs the state changes with the
> right (org- or personal-) session credentials, durably and idempotently.
> `services/` shrinks to reads + validation + context gating + activity
> writing.

## 1. The reference pattern (the three up-to-date c4 views)

| Leg (view) | Producer | Where the state change happens |
|---|---|---|
| **send** (`invitation`, `admin-invitation-send`) | `createInvitation` RPC | **currently** a synchronous PUT in the RPC. **Step 1 changes this** to activity-first (`invitationCreated` + workflow) — the send leg is the best-documented in `docs/temporal.c4`, so it is the first move (§7). The RPC mints the invitation id via `iriForContained` and writes the activity; the **workflow generates the capabilityUrl** when it PUTs the invitation — so the capabilityUrl is unknowable before the invitation exists (no pre-PUT accept window) |
| **accept** (`invitation`, `admin-invitation-send`, `admin-invitation-receive`) | `acceptInvitation` RPC | **activity only**: PUT `invitationAccepted` into the acceptor's Activity Registry (own or org), payload = ready-made workflow input, returns `{ accepted: true }` pending ack; the acceptor's **own** workflow (`getSession(webId)` — personal *or* org like `yoyo`) POSTs the opaque capabilityUrl, builds acceptor→inviter + reciprocal, only then `markActivitiesDone` |
| **inviter side** (`invitation`, `admin-invitation-receive`) | `InvitationHandler` | writes `agentRegistrationAdded` **activity** → `establishReciprocal` workflow |

The **mechanics** — dispatch, owner/admin channel split, pending→done
forwarding, completion semantics — are the reference for every step below;
the send-leg RPC shape is the first thing this plan changes. Mechanics that
make it work (all present in `packages/components/src/ActivityWebhookHandler.ts`):

- per-activityType dispatch — `activityWorkflows` map + `GRANTEE_ACTIVITY_TYPES`
  / `ADMIN_ACTIVITY_TYPES` sets;
- **owner channel dispatches, admin channel forwards only** (`isRegistryOwner`)
  — org-context `pending`/`done` reach the admin UI on the existing
  `/.sai/events` stream;
- `accountId` pass-through only for workflow types that subscribe webhooks /
  push (`agentRegistrationAdded`, `invitationAccepted`);
- completion semantics: one orchestrator per activity, `markActivitiesDone`
  only after **all** child branches succeed (the
  `processAdminChange` fix for createAdminGrants-masks-syncAdminAcr).

## 2. Current state (as-is)

All paths are RPC service methods in `packages/components/src/services/*`,
dispatched from `ApiHandler.ts` via `resolveContext` (`services/Context.ts` —
the phase-3 invariant: **the RPC session is always the signed-in user's
AuthorizationAgent; no org session is minted in RPCs**).

### 2.1 Already activity-first ✓
- `acceptInvitation` (`SocialAgentRegistry.ts:184`) — activity-only RPC
  (aligned to the step-1 template: `InvitationAcceptedId` ref, verbatim
  object, no `target`; the acceptor workflow POSTs the capabilityUrl + builds
  acceptor → inviter + reciprocal).
- `createInvitation` (`InvitationRegistry.ts`) — **step 1**: the RPC mints
  the invitation id and writes `invitationCreated` (object = the
  invitation-to-be pojo); the `createInvitation` workflow PUTs the invitation
  and generates the capabilityUrl there. The reference template for steps
  2–8 (the `InvitationCreated` form).
- `updateRole` (`RoleRegistry.ts`) — **step 2**: the RPC keeps a read-side
  existence guard and writes the intended change only
  (`roleMembershipChanged` — `target` dropped, object = the role-to-be
  `RoleData`, `as:Update`) + returns a pending ack (role-to-be + `activityId`);
  the `updateRole` workflow PATCHes the role (`updateRoleInRegistry`,
  find-first idempotent), derives the affected diff from the before-image,
  regenerates grants and completes. The second `InvitationCreated`-form
  template.
- `deleteRole` (`RoleRegistry.ts`) — **step 3**: the RPC keeps a read-side
  guard and writes the intended deletion only (`roleDeleted` — `target`
  dropped, object = the role-to-be-deleted as a real-id embedded `RoleData`;
  the embedded members are the retry backstop once the role is gone) +
  returns `RoleDeletedMessage` (deleted role id + `activityId`). The
  `deleteRole` workflow scans usage BEFORE the deletions, deleteAuthorizations,
  DELETEs the role (`deleteRoleFromRegistry`, find-first 404-tolerant),
  derives the affected set from the embedded members, regenerates, completes.
- `InvitationHandler` + `establishReciprocal` — the inviter side, aligned:
  the handler pre-mints the registration id (container form) and writes
  `agentRegistrationAdded` (real-id embedded object) only; the workflow PUTs
  the registration at `object.id` + discovers the reciprocal (completion via
  the `AgentRegistrationAddedId` ref).
- `addAdmin` / `removeAdmin` (`Admin.ts`) — activity + `processAdminChange`
  (`createAdminGrants`/`revokeAdminGrants`/`syncAdminAcr`), **but** the RPC
  still synchronously writes/deletes the `AdminAuthorization` (R1 decision).
- `ReciprocalWebhookHandler` — writes `delegatedGrantsUpdated` → `updateDelegatedGrants`.

### 2.2 Partial — RPC mutates synchronously, then activity → workflow does derived work
- `recordAuthorization` (`Authorization.ts:281`) — `recordAuthorizationFromStructure`
  (creates DataAuthorizations, ensures app registration, updates registry
  links) **then** `authorizationRecorded` → per-grantee consumer
  (`processGranteeActivities`) regenerates grants.
- `shareResource` (`ShareResource.ts:164`) — `shareDataInstance` synchronously,
  then one `authorizationRecorded` per deduped grantee. Known org-context debt:
  `shareDataInstance` writes on the session's *own* registry set (code comment
  "unexercised, tracked as debt").

### 2.3 Fully synchronous — no activity at all
- `revokeGrants` (`Revocation.ts`) — calls `GrantRevocationHandler.revokeGrants`
  directly with `ctx.session`; **no activity is written today** (`grantsRevoked`
  has no producer per `revoke-delegation-chain.md`).
- `createRole` (`RoleRegistry.ts:33`) — deliberate ("no authorizations can
  exist before role is created").
- `createInvitation` — **moved to activity-first in step 1** (see §2.1).
- `addSocialAgent` (`SocialAgentRegistry.ts:172`) — creates a registration,
  **no activity, no reciprocal** (only the invited flow establishes
  reciprocals).
- `requestAccessUsingApplicationNeeds` (`ShareResource.ts:207`) — single PATCH
  via `setAccessNeedGroup`.

### 2.4 Reads (stay in services)
`getSocialAgents`, `getApplications`, `getDescriptions`, `getRoles`,
`getSocialAgentInvitations`, `getDataRegistries`, `listDataInstances`,
`getResource` — already SPARQL/proxy-backed (`queries/org.ts`, `peerProxy.ts`).

### 2.5 Infra (not domain processing)
`AccountService` (bootstrap/checkHandle), `resolveContext` (access gate),
`adminGate`/`AdminSparqlHandler`/`ProxyAdminHandler` (HTTP endpoints),
`AgentIdHandler`, `InvitationHandler`, `GrantIssuanceHandler`,
`GrantRevocationHandler`, `ReciprocalMirror` (already temporal activities,
dormant until phase 4b).

## 3. Feasibility — why the move works

1. **The worker mints real sessions for any webId — personal or org.**
   `buildSessionManager().getSession(payload.webId)` →
   `AuthorizationAgent.build(webId, ..., registryId(webId))`
   (`SessionManager.ts:16`). The org's session holds `fullOwnerAccess` + grantee
   credentials on its own registries — already proven by `acceptInvitation`
   running as `yoyo` (admin-invitation-receive). No new session machinery.
2. **RPCs are credential-limited; workflows are not.** The RPC session (the
   admin's UAS) is ACP-limited: `fullAdminAccess` works only on un-`.acr`-ed
   containers; PATCH/DELETE of **seeded** resources 403s as Dan
   (org-context-sparql §3.4 debt). Moving mutations into org-session workflows
   **fixes that debt as a side effect** — notably `revokeGrants` (seeded grant
   closures carry own `.acr`s) and `shareDataInstance`'s org-context registry
   targeting.
3. **All plumbing exists.** Dispatch map, owner/admin channel split, completion
   semantics, `reconcileActivities` sweep, workflow-module bundling, and the
   kv.json channels (yoyo owner channel + dan's yoyo-admin channel are
   pre-seeded, §6.7). The only per-step work is wiring.

## 4. Per-write-path assessment (every row maps to §7)

| # | Path (file) | Verdict | What moves to temporal | Activity payload | Blockers / decisions |
|---|---|---|---|---|---|
| 4a | `recordAuthorization` (`Authorization.ts`) | ✅ move | the authorization recording itself — a workflow running as `getSession(ctx.webId)` calls `recordAuthorizationFromStructure` → grants → completion | the full RPC `Authorization` structure (already JSON-serializable) + `grantedBy`/registry-set IRI | design: dedicated per-activity workflow (role-workflow style) **vs** extending the coalescing per-grantee consumer (which today reads authorizations from the registry — would read from payloads instead); RPC response becomes pending ack / echo |
| 4b | `shareResource` (`ShareResource.ts`) | ✅ move | `shareDataInstance` into an org-session workflow; **also fixes the org-context debt** (session-own registry targeting) | `ShareDataInstanceStructure` + applicationId (+ clientId-doc callback for the response) | same consumer-vs-dedicated choice as 4a; `getResource` stays in services |
| 4c | `updateRole` / `deleteRole` (`RoleRegistry.ts`) | ✅ move | the role PATCH/DELETE + the affected-members diff (workflow loads the role first — `deleteRole` needs `role.members` *before* deletion) | `{webId, roleId, label?, members?}`; peers derived in the workflow | `createRole` stays synchronous (4f); RPC response shape (pending ack / echo) |
| 4d | `revokeGrants` (`Revocation.ts`) | ✅ move | owner-UI revocation into a workflow running `GrantRevocationHandler` with the **org** session (fixes seeded-ACR 403) + `removeGrantsFromRegistration` for the grantor's projection; introduce the missing `grantsRevoked` **producer** | `{webId, dataOwner, grants, grantee?}` | `processGrantsRevocation` today is the *grantor-side requester hop* (POST AccessRevocation to the data owner) — decide reuse vs a local-revoke orchestrator |
| 4e | `addAdmin` / `removeAdmin` (`Admin.ts`) | ⚠️ optional | extend `createAdminGrants`/`revokeAdminGrants` to also record/delete the `AdminAuthorization`, so the RPC becomes activity-only | unchanged `{webId, admin}` | **re-decide R1**: async loses RPC-time error semantics (already-admin/non-admin; RPC last-admin guard). Middle ground: keep RPC-time *validation reads* (duplicate check, last-admin count) and move only the write; `syncAdminAcr` already enforces the guard at workflow time |
| 4f | `createRole` (`RoleRegistry.ts`) | ➖ keep | — | — | no derived work; existing "no workflow" decision |
| 4g | `createInvitation` (`InvitationRegistry.ts`) | ✅ **move — step 1** (best-documented in `docs/temporal.c4`) | RPC mints the invitation id (`iriForContained` on the invitation registry) and writes `invitationCreated` (actor + `as:object` = the invitation-to-be `CreateInvitationPojo` — `{ id, type, label, note }`, **no capabilityUrl**); a `createInvitation` workflow PUTs the invitation resource at the minted id with the context session, generates the capabilityUrl there, then completes | `{ actor, label, note, invitationId (as:object.id) }` — capabilityUrl is generated in the workflow, never in the RPC/activity | **latest (payload-contract-alignment/object-embedding):** the capabilityUrl is unknowable before the workflow PUTs (the UI can't leak it early; no pre-PUT accept window); `InvitationHandler` unchanged; the c4 send legs change (updated in this step) |
| 4h | `addSocialAgent` (`SocialAgentRegistry.ts`) | ⚠️ optional — **no RPC consumer today** (grep-verified: not wired in `ApiHandler.ts`, `effect.ts`, or the UI) | if ever wired: registration PUT into a workflow; **decide whether it also establishes the reciprocal** (manual add ≠ invited add today) | `{webId, agent webId, label, note}` | new `socialAgentAdded` activity type + reconcile branch + UI wiring if moved; **otherwise housekeeping — not a user-facing step** (§7, §9) |
| 4i | `requestAccessUsingApplicationNeeds` (`ShareResource.ts`) | ➖ keep | — | — | single PATCH; activity+workflow overhead not justified |

## 5. What stays in services

- **All reads** (§2.4) — already transport-migrated; nothing to move.
- **`resolveContext` + the admin gate** — the authorization boundary in front of
  RPCs, not processing. (The worker's `getSession` is trusted server-side; no
  gate needed there — the payload's `webId` is the owner.)
- **`AccountService`** — cannot be activity-first by construction: bootstrap
  creates the Activity Registry itself (chicken-and-egg).
- **The HTTP handlers** (`AgentIdHandler`, `InvitationHandler`,
  `GrantIssuance/RevocationHandler`, `AdminSparqlHandler`, `ProxyAdminHandler`)
  — enforcement/protocol endpoints. `GrantRevocationHandler`'s *logic* is
  reused from workflows, not moved.
- **`ReciprocalMirror`** — already temporal activities (dormant until 4b).

## 6. Cross-cutting constraints (every step)

1. **RPC response shapes.** `acceptInvitation` set the precedent: pending ack +
   UI refresh on `done`. Every moved write needs a decided shape: pending ack,
   echo of inputs (`createRole`-style), or unchanged where reads suffice.
   `addAdmin` today returns the fresh profile — note its `admin` flag is stale
   until the workflow links `hasAdminGrant`; a pending ack is more honest.
2. **`accountId` pass-through.** `ActivityWebhookHandler` special-cases
   `agentRegistrationAdded`/`invitationAccepted`. New types need it only if
   they subscribe webhooks or push — extend the conditional per type, don't
   broaden it.
3. **Idempotency.** Every new workflow idempotent under retries/re-delivery:
   `find`-first, single-PATCH link replace, `If-None-Match: *` PUTs,
   404-tolerant deletes, full regeneration. The moved AA methods are already
   regeneration-shaped.
4. **`reconcileActivities` coverage** (`workflows/grants.ts:315`) — the
   correctness backstop must gain a branch for **every** new activityType, or
   missed deliveries stay pending forever. Mandatory companion per new type
   (incl. the §2.3 producers that gain activities).
5. **Workflow-module bundling.** New workflows exported from
   `temporal/workflows/create-grants.ts` (or a new module added to the bundle
   in `workers/main.ts`) so the `create-grants` worker claims them — the exact
   gap Phase 2 hit with the admin workflows.
6. **Completion semantics.** Follow `processAdminChange`: one orchestrator per
   activity; children never mark done themselves; single completion after all
   branches succeed.
7. **Seeds / channels.** Already present in `environments/data/kv.json`: yoyo
   owner channel (webId `yoyo`, topic `registry/yoyo/activity/`) **and** dan's
   admin channel (webId `dan`, same topic). New orgs exercising moved flows
   need the same pair (owner + per-admin, per R3 §3.2).
8. **Docs rows.** `events.md` + `peer.md` producer/consumer tables gain a row
   per new activityType (`grantsRevoked` currently lists "no producer").
9. **Tests.** Two tiers: vitest for new activities/workflows in
   `packages/components/test` (the `grants.test.ts` pattern: mock
   `buildSessionManager` + `SparqlEndpointFetcher`) and `/test` wait-for
   workflows parity suites like the invitation tests. More activity-first RPCs
   ⇒ more wait-for suites.
10. **Payload/activity contract — see the dedicated prerequisite plan
    [`payload-contract-alignment.md`](payload-contract-alignment.md).**
    Summary: activities become **typed RDF classes** — `ActivityData` is a
    discriminated union on `type: ['Activity', '<Class>']` (capitalized) with
    **flat interfaces** (no nested `payload` blob) whose fields are **plain
    IRIs on the wire** — the storage law: no `{ id, type }` ref objects in any
    SPARQL-queried registry, refs stay TS-level (temporal inputs/builders)
    — `target` stays a plain IRI, and the owner field is `actor`
    (`as:actor` — verified the generic `webId` predicate is used nowhere
    else); `ActivityWebhookHandler` decodes (`S.decodeUnknownSync`) at the
    dispatch boundary instead of `as object`
    casts (migrating
    `invitationAccepted`/`agentRegistrationAdded` off bare strings and
    unifying: `reciprocal.ts` → `getSession(payload.actor)`,
    `grants.ts`/`admin.ts` → `payload.webId`/`payload.actor`). The
    canonical shapes live in `data-model` (effect-free); `api-messages` holds
    the Schema projections, with colliding RPC types suffixed
    `Message`/`Procedure` (`InvitationAccepted` → `InvitationAcceptedMessage`).
    The `iri` → `id` rename (incl. `activityIri` → `activityId`) lands with
    that plan's step-3 wire flip. Every moved step here adds its activity
    class there first.

## 7. Sequencing — one step per service function

Each step updates **and verifies** all three artifacts: `/test` suites
(wait-for workflows wherever the RPC became activity-first),
`docs/temporal.c4` (the affected dynamic views), and `ui/authorization/`
(store + views + the activity indicator). Checkpoint after every step:
`npm run build && npm run test` (turbo, serial); `/test` runs user-side
(dagger) and each step flags its Infra dependency (Temporal/CSS) explicitly.
Companion tasks (handler rows, reconcile branches, workflow bundles,
`events.md`/`peer.md` rows) ride each step.

| Step | Service function (RPC) | Scope | §4 rows |
|---|---|---|---|
| **0. UI activity tracking + indicator** | infra — no RPC move | `ui/authorization/src/store/` (+ `events.ts`): track **accepted activities** — record `pending` → `done` per activity IRI and expose them to the views; a small indicator (applying… spinner → done check) beside the triggering control / list row. **Verified with `acceptInvitation`** (already activity-first, the most understood lifecycle): fire an accept → indicator pending → done → list refresh. **Implemented:** store tracker + claims + app-shell snackbar + `ACTIVITY_LABELS` map (spinner/amber → ✓/light-green, 5s auto-hide), verified via the create flow; the **accept claim** is wired in `store.acceptInvitation` with the ack-echoed `activityId` anchor (uniform — see the contract snapshot). Everything is in place and reused per step | — |
| **1. `createInvitation`** | `CreateInvitation` | **first move** — best-documented leg in `docs/temporal.c4`. RPC: mint the invitation id (`iriForContained`), write `invitationCreated` (actor + `as:object` = the invitation-to-be `CreateInvitationPojo`, **no capabilityUrl**), return pending ack; workflow (`createInvitation`): PUT the invitation at the minted id with the context session, **generate the capabilityUrl there**, then complete. Update the `invitation` + `admin-invitation-send` **send legs** in c4; `/test` invitation suites become wait-for; UI: indicator + list refresh on done | 4g |
| **2. `updateRole`** | `UpdateRole` | **✅ EXECUTED** — the role's *intended* change rides `as:object` as a **real-id embedded projection of the role-to-be** (`{ id, type: [Role], label, members }` — the InvitationCreated form; **`target` removed**, `roleId` reads `object.id`, `as:Update`); the RPC keeps a read-side existence guard + writes the activity + returns a pending ack (echoes the role-to-be + `activityId`); the `updateRole` workflow PATCHes the role (`updateRoleInRegistry` — find-first idempotent) → derives the affected diff from the before-image → regenerates → completes; `role-membership-change` c4 view + UI (claim + done-row) | 4c |
| **3. `deleteRole`** | `DeleteRole` | **✅ EXECUTED** — `as:object` = the role-to-be-deleted as a **real-id embedded projection** (the full `RoleData`, alive at write; **`target` removed**, `roleId` reads `object.id`); the RPC keeps a read-side guard (existence, yields the snapshot) + writes the activity + returns a pending ack (`RoleDeletedMessage` = deleted role id + `activityId`); the `deleteRole` workflow scans usage **before** the deletions, deleteAuthorizations, DELETEs the role (`deleteRoleFromRegistry` — find-first, 404-tolerant, idempotent under retries), derives the affected set from the **embedded members** (the retry backstop — unrecoverable from the store after the role + its role-grantee authorizations are gone), regenerates, completes; same c4 view + UI (claim + done-row) | 4c |
| **4. `revokeGrants`** | `RevokeGrants` | introduce the missing `grantsRevoked` **producer**: activity = `actor`, flat `grantee`/`dataOwner` (existing terms) + `as:object` = the revoked grant IRIs (set); local-revoke workflow runs `GrantRevocationHandler` with the **org** session (fixes seeded-ACR 403) + clears the grantor's projection; `authorization`/`revoke` UI + c4 | 4d |
| **5. `addAdmin`** | `AddAdmin` | activity = `actor`, `as:object` = the AdminAuthorization-to-be as a **real-id embedded projection** (pre-minted — the workflow PUTs it; **`target` removed** — nothing consumes the registry container); re-decide R1 (§9): RPC-time validation reads (already-admin) + activity-only write; `org-admin-add` c4 + toggle-admin UI | 4e |
| **6. `removeAdmin`** | `RemoveAdmin` | same re-decision, distinct `adminAuthorizationRevoked` (`as:object` = the existing AdminAuthorization as a **real-id embedded projection** — the workflow DELETEs; **`target` removed**); the last-admin guard rides the workflow (`syncAdminAcr`); `org-admin-add` (remove) c4 + toggle-admin UI | 4e |
| **7. `recordAuthorization`** | `AuthorizeApp` (`authorizeApp`) | **moved to the end (POJO-first reorder)** — structure-based: the object fields (`AuthorizationStructure`) have NO `dataModelContext` terms (execution note 9 in `payload-contract-alignment.md` — expansion silently drops unknown keys), so the carrier needs the structure-vocab decision first. Then: RPC pre-mints the DataAuthorization id(s) (`iriForContained`); the activity's `as:object` = the **real-id embedded projection** of the DataAuthorization-to-be (the InvitationCreated form; **`target` removed** — nothing consumes it, the id rides `object.id`); workflow records the authorizations at those ids (`recordAuthorizationFromStructure` as `getSession(ctx.webId)`) → grants → completion; RPC returns pending ack; `authorization` c4 view + UI refreshed on done; handler + reconcile (per-grantee consumer reads `grantee` from the object — decision 1) | 4a |
| **8. `shareResource`** | `ShareResource` | **moved to the end** — structure-based (same term gap as step 7). `ShareDataInstanceStructure` + applicationId ride as the flat structure fields (structure-based — followup); the authorization(s) record via a pre-minted `as:object` id; workflow performs the share as the context session — **fixes the org-context debt** (session-own registry targeting); `share-resource` / `share-resource-get-data` c4 views + UI | 4b |
| **9. `createRole` — keep, verify** | `CreateRole` | **stays synchronous** (no derived work — "no authorizations can exist before role is created"); step = regression coverage in `/test`, no c4/UI change beyond the indicator; re-entry criterion: a workflow becomes necessary if credentials, durability, or uniform UI require it | 4f |
| **10. `requestAccessUsingApplicationNeeds` — keep, verify** | `RequestAccess` | **stays synchronous** (single PATCH); verify-only step | 4i |
| — (housekeeping) | `addSocialAgent` | **no RPC consumer** (grep-verified) — not a user-facing step; decide later whether to wire it (and with what reciprocal semantics) or drop it (§9) | 4h |
| **11. Docs alignment** | — | `events.md` + `peer.md` rows per new type; `workflow-temporal-decupling.md` producer table (rows 2–7); final c4 sweep | — |

Order rationale: **step 0** gives every subsequent move its UI verification
vehicle; **step 1** is first because the invitation send leg is the
best-documented in `docs/temporal.c4` — a low-risk, well-understood move
that also exercises the new `pending→done` indicator against a real flow;
**steps 2–6 move the regular-POJO classes first** — `RoleData`,
`GrantsRevoked`, `AdminAuthorizationData` are term-covered (no contract gap),
so roles (update/delete), revocation, then the admin pair that re-decides
R1 land green one at a time; **the structure-based steps 7–8
(`recordAuthorization`, `shareResource`) land LAST** — their `as:object`
forms need the structure-field vocabulary followup (execution note 9 in
`payload-contract-alignment.md`: JSON-LD expansion silently drops untemmed
structure keys), and open decision 1 (dedicated workflow vs per-grantee
consumer) rides along; steps 9–10 are explicit verify-only keepers; step 11
closes the docs.

### Foundation — the contract flip (first, before step 1; verifies green alone)

> **✅ EXECUTED — the amended contract is landed and green (`/test` 150/150).**
> This section is historical; the executed wire + the execution-time decisions
> are recorded in `payload-contract-alignment.md` **Execution notes** (the
> `as:object` carriers per class, `type`-order canonicalization, snapshot
> `type` normalization, `typeGrantee` publication, 404-tolerant grantee
> resolution). Steps below now build on that committed state — step 0 picks up
> the UI half only.

The committed base (`payload contract alignment`, step-1/2 of
`payload-contract-alignment.md`) is **pre-flip**: producers still write the
legacy `{ activityType, payload }` wire and `LegacyActivityData` is exported.
Land the **amended** contract first (the amendments + the inventory in
`payload-contract-alignment.md` are authoritative over its step-1–3
sketches):

1. **Wire (data-model / authorization-agent):** `ActivityRegistry.createActivity`
   writes the typed class tuple (`type: ['Activity','<Class>', <as:*…>]`),
   flat fields + the `as:object` forms — **no `activityType`, no `payload`**
   (`JSON.stringify` retired); `loadActivity` frames the **single fetched
   document** → `ActivityData` (refs back as plain IRIs); `createCompletion`
   emits `ActivityCompleted` with `target: completedId`; `getCompletedActivityIris`
   reads the `type` discriminant; retire `LegacyActivityData` (consumers switch
   to `ActivityData`).
2. **Vocab/context:** add ASV terms to the `ACTIVITYSTREAMS` vocabulary:
   `as:target` (for `target`), `as:object`, `as:Accept`, `as:Create`, `as:Add`
   (class terms + `as:actor` are already in the base). **No new interop field
   predicates** — parties ride the object (amended decision).
3. **Read path — object embed:** pinned single-doc
   (`fetchJsonLd` + `frameDoc`); the `object` frame entry uses
   **per-field `@embed: '@always'`** where a consumer reads the fields
   (snapshot nodes embed from the same doc — no cross-graph read;
   live-link objects embed by GRAPH-union only where needed —
   `payload-contract-alignment.md` §5 exempts `as:object`); the default
   `@embed: '@never'` yields `object: { id }` (UI/events path — it reads
   nothing from the object).
4. **api-messages:** object-projection Schemas (`object` typed via the
   data-model POJO projections — pulls the step-4 derivation in), relaxed
   `type` tuples incl. the ASV type; `InvitationAcceptedMessage` is already
   in the base.
5. **Handler:** dispatch on `activity.type.includes('<Class>')`, decode
   `S.decodeUnknownSync(<class Schema>)`, build the workflow input from the
   `object` fields (`XId` wraps stay temporal-side); `activityIri` …
   `activityId` naming.
6. **Renames (compiler-checked):** `activityIri` → `activityId`,
   `webId` → `actor`, `iri` → `id` (the `queries/org.ts` surface — sparql
   query params, `peerFetch`/`peerProxy` `targetId`, `getResource(ctx, id)`).
7. **UI:** `ui/authorization/src/store/app.ts` must use
   `InvitationAcceptedMessage` for the accept ack (the base does not
   typecheck otherwise — already fixed); `events.ts` done-rows dispatch on
   `type` and read the flat/object fields; the capabilityUrl is **learned
   from the invitation resource after completion** (the `InvitationCreated`
   done-row triggers `listSocialAgentInvitations` — never from an RPC or
   activity).
8. **Tests/docs:** `/test` invitation + org-context suites and the
   `temporal.c4` examples to the new wire.

### Contract snapshot (agreed, authoritative)

- **Wire fields:** `as:actor` (owner), `as:target` (changed record/container,
  or — for `ActivityCompleted` — the completed activity IRI; on role classes
  `target` ≡ the role IRI), `as:object` in one of **three** forms, `as:*`
  activity types beside the interop class. `createdAt` stays
  `interop:createdAt`; `GrantsRevoked` keeps flat `grantee`/`dataOwner`
  (existing terms).
- **`as:object` forms** (per class — see the amended inventory in
  `payload-contract-alignment.md`):
  - **live link** — the object EXISTS at write (dereferenceable): wire =
    single `as:object <iri>` triple ([
    `DelegatedGrantsUpdated`]);
  - **real-id embedded projection (the step-1/InvitationCreated form)** — id
    pre-minted at write, resource materialized/deleted by the workflow
    later, fields known at write: the producer embeds the **full data-model
    POJO projection at the REAL pre-minted id, `type` included** (the pojo
    minus what the workflow generates — `CreateInvitationPojo` pattern).
    The activity-graph `rdf:type` claim never surfaces as authoritative:
    classification reads self-graph-filter (`docs/sparql.md` —
    `FILTER(?g = ?s)`, adopted with step 1). Re-pins: `AuthorizationRecorded`
    (+`Revoked`), `AdminAuthorizationRecorded` (+`Revoked`),
    `RoleMembershipChanged`/`RoleDeleted` (the *intended* change rides the
    role-to-be).
  - **snapshot** — id UNKNOWN at write (`InvitationAccepted`): a minted
    `urn:uuid` node carrying the full POJO projection (type incl.); never
    dereferenced. `urn:uuid` snaps are for id-unknown-at-write only — a
    known id uses the real-id embedded form, not a second urn node.
- **`as:target` drops with the embedded form (InvitationCreated precedent).**
  A class whose changed-record id rides `object.id` has NO `target`; the
  changed container is not consumed. Removed now: `InvitationCreated`,
  `InvitationAccepted` and `AgentRegistrationAdded` (the invitation legs
  aligned to the template; a pre-minted registration id also rides
  `object.id`, the synchronous handler create moved into the workflow); and
  `RoleMembershipChanged` (**step 2 landed** — the role-to-be rides
  `object.id` at the existing role IRI, `as:Update`) and `RoleDeleted`
  (**step 3 landed** — the role-to-be-deleted rides `object.id`; the embedded
  members are the retry backstop once the role is gone). Scheduled with their
  re-pins:
  `AdminAuthorizationRecorded`/`Revoked` (steps 4–5),
  `AuthorizationRecorded`/`Revoked` (steps 7–8). Kept for
  the classes whose `target` is a delivered dispatch value
  (`DelegatedGrantsUpdated` — the peer) or the completion target
  (`ActivityCompleted` — the machinery's payload).
- **Parties ride the object:** `admin`/`authorizationGrantee`/`peerId` are
  not flat fields — consumers read them from the object (`grantee`,
  `registeredAgent` inside the embedded/linked POJO); the embedded form
  gives them to the workflow WITHOUT dereferencing (critical when the
  resource doesn't exist at dispatch); `roleId` rides `object.id` for the
  re-pinned role classes (step 2 landed); `peers` and the grantee kind are
  derived by the workflow/consumer.
- **capabilityUrl lives in the workflow** (step 1): the activity carries no
  capabilityUrl — it is generated when the workflow PUTs the invitation (the
  RPC returns a pending ack echoing label/note + the minted id). No pre-PUT
  accept window exists (the capabilityUrl is unknowable early); the accept
  side's retry policy is therefore not needed for that window.
- **The pending ack echoes the activity id** (the uniform UI claim anchor):
  `createActivity` returns the minted activity id — producers echo it in the
  ack (`InvitationCreatedMessage`/`InvitationAcceptedMessage` gain
  `activityId`); the store claim binds the stream event by that id exactly
  (unique per activity — no context+class cross-binding, works uniformly for
  live-link / embedded / urn:uuid-snapshot / set object forms). Fallback:
  context + class (+ optional object) matching for ack shapes without an id.
- **Producer/workflow split (mint-in-service, step-1 pattern):** the service
  (admin's AA) does registrySet discovery + id minting (`iriForContained`) +
  the activity write (the object = the real-id embedded projection of the
  resource-to-be); the workflow does the actual resource PUT/DELETE at the
  minted/existing id (find-first by the STABLE id — the idempotency key,
  never a per-run generated value) + follow-ups + the single completion.
  Exceptions: `InvitationAccepted` (no owning container on the acceptor side
  → `urn:uuid` snapshot); RPC responses whose resource no longer exists
  synchronously become **pending handles** (minted id + derived fields);
  guards stay read-side in the RPC and are re-checked in the workflow
  (last-admin via `syncAdminAcr`).
- **The workflow's webId is the channel's, not the activity's** — dispatch
  settles the session from the webhook `channel.webId` (the trust anchor
  used by every dispatch branch); the activity's `actor` is not re-derived
  from the payload for the workflow's own identity (all branches aligned,
  incl. the invitation legs). `accountId` pass-through only for webhook/push
  types.
- **Multi-param signatures + the activity ref (step-1 pattern):**
  `invitationCreated` set the template — the workflow takes
  `(webId, object-pojo, <Class>Id)` where `<Class>Id` is the typed ref to the
  triggering activity (XId convention, traceable completion); the activity
  itself takes `(webId, object-pojo)` only — the completion (`activityId`)
  lives in the workflow. The handler passes the **decoded object verbatim**
  as the workflow's data arg (single source: the shared pojo type lives in
  `data-model`). New workflows bundle on the `create-grants` worker (§6.5).
- **Not adopted:** `as:result`; structure-based classes
  (`AuthorizationRequested`/`ShareRequested`) stay flat — followup in
  `payload-contract-alignment.md` §5.

### Per-step contract checklist (every activity-first step does ALL of these —
updated to the step-1/`invitationCreated` template)

For each class a step adds:

- [ ] **data-model** — `INTEROP` class term + `dataModelContext` entry; the
  interface in `packages/data-model/src/activities.ts` per the amended
  inventory (the class's `as:object` form; a workflow-materialized class
  uses the **shared object pojo** — the `CreateInvitationPojo` pattern:
  `*Data` minus the workflow-generated fields, typed as `object`) +
  `ActivityData` union member + the **`<Class>Id` activity ref** (XId
  pattern) where the workflow completes.
- [ ] **api-messages** — Schema projection (object forms; `type` tuple =
  `['Activity','<Class>', '<as:*>']`); RPC `Message`/`Procedure` suffix on
  name collisions (`InvitationAccepted` → `InvitationAcceptedMessage`
  precedent).
- [ ] **Producer (mint-in-service)** — registrySet discovery + pre-mint the
  resource id (`iriForContained`) where the workflow creates the resource;
  write the activity (object = the real-id embedded projection — no
  workflow-generated fields); RPC response = pending ack/echo (a pending
  handle with the minted id) per the decided contract; guard reads stay,
  workflows re-guard.
- [ ] **Handler** — dispatch branch + schema decode + **the decoded object
  passed verbatim** as the workflow's data arg (mutability spread for
  `type`); `webId` = the channel's (`channel.webId`); `accountId`
  pass-through only for webhook/push types (`agentRegistrationAdded`,
  `invitationAccepted`).
- [ ] **Workflow** — multi-param signature `(webId, object-pojo,
  activity: <Class>Id)`; PUT/DELETE at the minted/existing id (find-first by
  the stable id — idempotent under retries/reconcile); derive the
  diff/peers/grantee-kind from the object; generate capabilityUrl-type
  secrets where applicable; single completion (`markActivitiesDone` on the
  ref) after all branches succeed (the `processAdminChange` pattern —
  children never mark done); register on the `create-grants` worker bundle
  (`workers/main.ts`).
- [ ] **Reconcile** — a `reconcileActivities` branch for the class (same
  args — the decoded object + the activity ref; missed deliveries stay
  pending forever otherwise).
- [ ] **UI** — `events.ts` done-row refresh + store/view refresh + the
  step-0 indicator + the `ACTIVITY_LABELS` row
  (`ui/authorization/src/activityLabels.ts`).
- [ ] **Docs** — `events.md` + `peer.md` rows; the c4 view(s) for the leg.
- [ ] **Tests** — `/test` wait-for suite (RPC → pending → `waitFor` end-state
  → completion in the Activity Registry); vitest for the workflow/activity
  (the `grants.test.ts` mock pattern); reconciliation missed-delivery check.
- [ ] **Seeds** — kv.json owner + admin channels for any new org exercising
  the flow (yoyo owner + dan's yoyo-admin channel are pre-seeded).

**Verification per step (AGENTS.md):** agent runs packages vitest + the
monorepo build (`turbo`); `/test` suites are user-run (dagger). Both must be
green per step; `temporal.c4` edits validate with `likec4 validate`;
`ui/authorization` typechecks with `vue-tsc --noEmit`.

## 8. Testing

- **Workflows/activities (vitest, `packages/components/test`)**: per moved
  path, mock `buildSessionManager` + the SPARQL fetcher (existing
  `grants.test.ts` pattern) and assert the workflow's end-state + idempotency
  against re-delivery. New producers: assert the activity payload shape from
  the service (the `role-registry.test.ts` style).
- **API messages**: schema compile for any changed request/response shapes
  (pending acks; payload-carrying structures).
- **`/test` (user-run, dagger)**: every moved RPC becomes a wait-for-workflow
  suite (the invitation-tests shape): call RPC → assert pending → `waitFor`
  the end state → assert completion in the Activity Registry. Parity guards:
  `recordAuthorization`/`shareResource` end-state identical to today; org
  context exercises the **org-session** credential path for
  `revokeGrants` on seeded closures (the fixed debt) and
  `shareDataInstance` targeting the org's registry.
- **Reconciliation**: a forced missed delivery (handler down) recovers via
  `reconcileActivities` for each new type.

## 9. Open decisions (recorded, not yet made)

1. **Dedicated workflow vs extended per-grantee consumer** for
   `recordAuthorization`/`shareResource` (4a/4b).
2. **`revokeGrants` orchestrator**: reuse/extend `processGrantsRevocation`
   (requester-hop shape) or a new local-revoke workflow (4d).
3. **R1 re-decision**: synchronous `AdminAuthorization` write + RPC-time error
   semantics vs activity-only with async errors (4e) — re-decided in steps 5–6.
4. **`addSocialAgent`**: no RPC consumer today — wire it later (and decide
   whether it establishes the reciprocal) or drop it (4h).
5. **Keepers stay synchronous (decided)**: `createRole` and
   `requestAccessUsingApplicationNeeds` — re-entry only if credentials,
   durability, or uniform UI require a workflow (§7 steps 9–10).
6. **`createInvitation` moves (decided — step 1).** The c4 send legs change
   accordingly, and the c4 acceptance JSON examples change with the
   payload-contract wire flip (`webId` → `actor`, typed classes, plain-IRI
   links). Open
   sub-decisions: exact activity class shape (default `InvitationCreated` in
   `data-model`: `{ actor: string, label: string, note?: string, object:
   <minted invitation id> }` + `as:Create` — wire-truth plain IRIs; refs
   (`SocialAgentId`, `SocialAgentInvitationId`) appear only in temporal
   inputs/builders; the invitation id is pre-minted by the RPC via
   `iriForContained` and carried as `as:object`), RPC
   response (`InvitationCreatedMessage` pending ack **without** the
   capabilityUrl — it echoes label/note + the minted id; the capabilityUrl is
   generated in the workflow and learned via the invitation resource on
   completion), task queue (`create-grants` vs
   `reciprocal-registration`). The pre-PUT accept window is **moot**: the
   capabilityUrl is unknowable before the workflow creates the invitation, so
   the accept side can never race it.
7. **RPC response-shape contract**: pending ack vs echo, per moved method
   (constraint 1).
8. **RPC-message ↔ POJO duplication (near-identical pairs)** — decided in
   **`payload-contract-alignment.md` step 4** (optional hardening: derive
   message types from POJOs via `Pick`/field-map, or keep the `X.make()`
   mappers). Field names are already unified: `label` is the single
   `skos:prefLabel` term everywhere (the `prefLabel` → `label` rename
   landed).