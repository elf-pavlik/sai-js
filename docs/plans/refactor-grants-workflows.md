# Plan: Refactor grants workflows — full regeneration, clean reuse of `createGrantsForAgent`

> **Status:** implemented — all migration steps landed, typecheck + build pass, `test/` passes.
> ⚠️ One deviation: the HTTP-DELETE of old grant resources is **commented out** pending a
> 403 on grantor-side deletion of delegated grants (see design decision 3).

## Motivation

The Temporal workflows in `packages/components/src/temporal/workflows/grants.ts`
have grown divergent entry points that all funnel into `createGrantsForAgent`,
but each passes a *different, partial* set of authorization IRIs:

- `recordAuthorization` / `shareResource` pass only the **newly recorded** authorization IRIs,
- `updateGrantsForOneAgent` passes **all** authorizations for the agent (via `findAuthorizationsForAgent`),
- `updateGrantsForAuthorization` (via `findAffectedAuthorizations`) passes only the **filtered** IRIs of authorizations matching a data owner / role.

Because `createGrantsForAgent` clears **all** of the grantee's existing data-grant
links and re-adds only the grants generated from the IRIs it received, any caller
that passes a subset drops grants from the other (kept/reused) authorizations —
the "extend quirk" (already noted in `simplify-authorization-containment.md`).

Additionally, "deleting" today only removes the `hasDataGrant` links from the
agent registration (`removeAllDataGrants`); the grant **resources** (and their
ACRs) stay on the server as orphans.

## Goal

1. Make `createGrantsForAgent` **self-contained** and the single reusable unit:
   it takes `{ webId, grantee }` (grantee is always an agent), fetches **all** of
   the grantee's authorizations itself (including authorizations granted via roles
   the grantee is a member of), generates **all** grants, **HTTP-DELETEs** the
   old grant resources, stores the new ones, and updates the registration.
2. Step 1 behavior: *generate everything, delete everything*.
   > ⚠️ **Caveat (current state):** the HTTP-DELETE of old grant resources is
   > **commented out** in `createGrantsForAgent` — CSS denies the grantor's
   > DELETE (403) on delegated grants because the `AclPermissionsEngine`
   > requires `acl:Write` on the **parent grant-registry container** too, which
   > the grantor never has (see design decision 3). Registration unlink
   > (`clearDataGrantsOnRegistration`) still happens; the resources stay
   > orphaned on the server (pre-refactor behavior).
3. Future step (interface ready now): `checkEquivalence` compares generated vs
   existing grants and returns existing grants that are equivalent, so they are
   **reused** (kept, re-linked) instead of deleted and re-created. For now a
   dummy implementation pretends nothing is equivalent.
4. All entry workflows only resolve *affected grantees* and delegate to
   `createGrantsForAgent` (via `createGrantsForAuthorization` where role→member
   resolution is needed).
5. **Role as dataOwner caveat:** when a role is used as `dataOwner` of an
   authorization (e.g. `AllFromRole` scope), a role-membership change must
   regenerate grants for **all grantees of all authorizations that use that role
   as dataOwner** — not just the role's own members.
6. **Typed identifiers:** every id/IRI crossing a workflow/activity boundary is a
   `*Id` object (`{ id, type: string[] }`) — never a bare string.

Never regenerate the whole registry (except future recovery conditions — out of scope).

## Current architecture

### Entry points (started via Temporal client)

| Workflow | Started by | Notes |
|---|---|---|
| `createGrantsForAuthorization({webId, authorizationGrantee, dataAuthorizationIris})` | `Authorization.recordAuthorization`, `ShareResource.shareResource` | passes only new IRIs (extend quirk) |
| `updateDelegatedGrants({webId, peerId})` | `ReciprocalWebhookHandler` | passes filtered IRIs (extend quirk) |
| `processRoleMembershipChange({webId, roleId, peers})` | `RoleRegistry.updateRole` | part 1 per-peer full set; part 2 filtered IRIs |
| `processRoleDeletion({webId, roleId, peers})` | `RoleRegistry.deleteRole` | delegates to `processRoleMembershipChange` |
| `storeGrant(FinalGrantData[])` | `GrantIssuanceHandler` | data-owner side; **unchanged** |

### Current call graph

```
createGrantsForAuthorization
  └─ getGrantees()                    // role → members | agent → [agent]
  └─ createGrantsForAgent per member  // with the passed IRIs

updateGrantsForOneAgent(webId, peerId)              // only used by processRoleMembershipChange
  └─ getAuthorizations()                            // findAuthorizationsForAgent (resolves roles)
  └─ if empty → clearDataGrantsOnRegistration
  └─ else → createGrantsForAgent(peerId, allIris)

createGrantsForAgent(webId, grantee, dataAuthorizationIris)   // THE core
  ├─ generateGrants() → { sourceGrants, delegatedGrants }
  ├─ store source grants + ACRs (storeDataGrant + createAcr)
  ├─ requestDelegation() for delegated grants
  ├─ clearDataGrantsOnRegistration()   // unlinks hasDataGrant ONLY — resources orphaned
  └─ setDataGrantsOnRegistration()

updateDelegatedGrants → findAffectedAuthorizations() → updateGrantsForAuthorization → createGrantsForAuthorization
processRoleMembershipChange → updateGrantsForOneAgent per peer  +  findAffectedAuthorizations(roleId) → updateGrantsForAuthorization
```

## Target architecture

### Resource identities (`*Id`) in `packages/data-model`

Every id/IRI that crosses a workflow/activity boundary is passed as a typed
object, never a bare string. In `packages/data-model`, each entity model that
has a `*Data` interface gets a matching `*Id` interface extracted, with
`*Data = *Id & { ...rest }`:

```ts
export interface RoleId { id: string; type: string[] }          // type: [INTEROP.Role]
export type RoleData = RoleId & { prefLabel: string; members: string[] }

export interface DataAuthorizationId { id?: string; type: string[] }
export type DataAuthorizationData = DataAuthorizationId & {
  grantee: string
  grantedBy: string
  registeredShapeTree: string
  scopeOfAuthorization: string
  // ...rest unchanged
}
```

- Models with an optional `id` keep it optional (`GrantData`,
  `DataAuthorizationData` — absent until an IRI is assigned by the registry);
  the `Final*` variants are unchanged (`FinalGrantData = GrantData &
  Required<Pick<GrantData, 'id'>>`, same for `FinalDataAuthorizationData`).
- The extraction applies to **every** `*Data` model that carries `id` + `type`
  (`RoleData`, `GrantData`, `DataAuthorizationData`, `AgentRegistrationData`
  and its `SocialAgentRegistrationData` / `ApplicationRegistrationData`
  derivatives, `DataRegistrationData`, `ShapeTreeData`, `AccessNeedData`, …).
  All `*Id` types are exported from the data-model index.

Boundary-facing identities (with aliases used below):

| `*Id` | derived from | `type` value |
|---|---|---|
| `SocialAgentId` | agent identity (registration model: `SocialAgentRegistrationData`) | `[INTEROP.SocialAgent]` |
| `ApplicationId` | `ApplicationRegistrationData` | `[INTEROP.Application]` |
| `RoleId` | `RoleData` | `[INTEROP.Role]` |
| `DataAuthorizationId` | `DataAuthorizationData` | `[INTEROP.DataAuthorization]` |
| `GrantId` | `GrantData` | `[INTEROP.DataGrant]` |

Aliases: `AgentId = SocialAgentId | ApplicationId`,
`AgentOrRoleId = AgentId | RoleId`.

The `type` is determined by the **producer** (e.g. `findRoleUsage` /
`findAffectedGrantees` type the grantees they return), which lets consumers
branch on the entity kind without registry lookups: `Role` → resolve members
via `getGrantees`, agent types → use as-is. This removes the need for the
`ensurePeers` activity (see workflows below).

**How producers determine `type`** (same lookups the current code already
performs in `getGrantees`/`ensurePeers`):

- `AgentRegistry.findRegistration(registry, factory, iri)` →
  `ApplicationRegistrationData | SocialAgentRegistrationData | undefined` —
  the registered agent is typed `[INTEROP.Application]` / `[INTEROP.SocialAgent]`
  depending on which registration was found.
- `RoleRegistry.containedIncludes(registry, factory, iri)` → the iri is a
  `RoleId`; members via `factory.role(iri).members` (typed `SocialAgentId[]`).

### Existing building blocks to reuse (do not reinvent)

| Need | Existing function | Used by new activity |
|---|---|---|
| session for the webId | `buildSessionManager()` → `manager.getSession(webId)` (components) | all activities |
| all authorizations for an agent (incl. via roles) | `session.findAuthorizationsForAgent(peerId)` | `getAuthorizations` |
| generate grants from iris | `session.generateDataGrants(iris, grantee)` | `generateGrants` (maps `dataAuthorizations` → `.id`) |
| iterate / match authorizations | `AuthorizationRegistry.dataAuthorizations(registry, factory)`, `AuthorizationRegistry.findAuthorizationsDelegatingFromOwner(registry, factory, dataOwner, roleId)` | `findRoleUsage`, `findAffectedGrantees` (mirror the existing matching) |
| agent registration + type | `AgentRegistry.findRegistration(registry, factory, iri)` | `getGrantees`, type determination, `set/clearDataGrantsOnRegistration` |
| role check + members | `RoleRegistry.containedIncludes(registry, factory, id)`, `factory.role(id).members` | `getGrantees` (Role branch), type determination |
| current grants of a registration | `getDataGrantIris(registration)`, `getDataGrants(registration, factory)` (data-model `crud/agent-registration`) | `getExistingGrants` |
| link/unlink grants | `addDataGrant(registration, factory, iri)`, `removeAllDataGrants(registration, factory)` | `set/clearDataGrantsOnRegistration` |
| store grant + ACR (workflow helper) | existing `storeGrantAndAcr(grant)` — **keep it** | `createGrantsForAgent` |

All HTTP loops (store, `deleteDataGrants`, `deleteAuthorizations`) stay
**sequential** with the repo's existing comment: `// Change back to Promise.all
after the CSS bug is fixed.` (CSS SPARQL backend race on `dcterms:modified`).

### Workflows (`packages/components/src/temporal/workflows/grants.ts`)

```
storeGrant(FinalGrantData[])                                  // UNCHANGED

createGrantsForAuthorization({webId: SocialAgentId, authorizationGrantee: AgentOrRoleId})
  ├─ getGrantees({webId, grantee: authorizationGrantee}) → AgentId[]   // routes by type: Role → members
  └─ per agent → executeChild(createGrantsForAgent, { webId, grantee })

updateDelegatedGrants({webId: SocialAgentId, peerId: SocialAgentId})    // UNCHANGED signature
  ├─ findAffectedGrantees({webId, peerId}) → AgentOrRoleId[]            // typed by producer
  └─ per grantee → executeChild(createGrantsForAuthorization, { webId, authorizationGrantee })

processRoleMembershipChange({webId: SocialAgentId, roleId: RoleId, peers: SocialAgentId[]})
  ├─ usage = findRoleUsage({webId, roleId})   // { usedAsGrantee, affectedGrantees: AgentOrRoleId[], authorizations: DataAuthorizationId[] }
  ├─ affected: AgentId[] = []
  ├─ if (usage.usedAsGrantee)   // role used as grantee → members are the grantees
  │    affected.push(...peers)  // changed members' received grants changed
  ├─ for (const g of usage.affectedGrantees)   // role used as dataOwner → the *grantees of those authorizations* are affected
  │    if (g.type is Role) affected.push(...getGrantees({webId, grantee: g}))   // role → members
  │    else affected.push(g)                                                   // agent → as-is, NOT the members themselves
  └─ per agent in dedupe(affected) → executeChild(createGrantsForAgent, { webId, grantee })
      // a role can be used as grantee AND dataOwner across different authorizations —
      // both branches then apply; the two sets are merged and deduped

processRoleDeletion({webId: SocialAgentId, roleId: RoleId, peers: SocialAgentId[]})   // UNCHANGED signature
  ├─ usage = findRoleUsage({webId, roleId})   // scan BEFORE deletion — { usedAsGrantee, affectedGrantees, authorizations }
  ├─ deleteAuthorizations({webId, authorizations: usage.authorizations})   // separate deletion step
  │     // deletes ALL authorizations where grantee === roleId OR dataOwner === roleId;
  │     // usage info + IRIs were captured first, while the authorizations still existed
  ├─ affected: AgentId[] = []
  ├─ if (usage.usedAsGrantee)
  │    affected.push(...peers)   // role.members ARE the grantees of grantee-authorizations;
  │                              // unresolvable after deletion (role resource gone) → must come from the service
  ├─ for (const g of usage.affectedGrantees)   // grantees of dataOwner-authorizations — route by type
  │    if (g.type is Role) affected.push(...getGrantees({webId, grantee: g}))
  │    else affected.push(g)
  └─ per agent in dedupe(affected) → executeChild(createGrantsForAgent, { webId, grantee })
      // dataOwner-role members themselves are NOT regenerated: their received grants never
      // change (a grant is never issued on the grantee's own data); revocation of access to
      // their data happens via the grantees' regeneration (deleteDataGrants on the delegated
      // resources in their pods)

createGrantsForAgent({webId: SocialAgentId, grantee: AgentId})   // grantee = agent — SELF-CONTAINED
  ├─ authorizations = getAuthorizations({webId, peerId: grantee})   // DataAuthorizationId[] — ALL, incl. via roles
  ├─ existing = getExistingGrants({webId, peerId: grantee})         // GrantData[] from registration
  ├─ if authorizations.length === 0:                                // deny case
  │    deleteDataGrants({webId, grants: existing ids → GrantId[]})  // ⚠️ COMMENTED OUT (see design decision 3)
  │    clearDataGrantsOnRegistration({webId, peerId: grantee})
  │    return
  ├─ generated = generateGrants({webId, grantee, dataAuthorizations: authorizations})  // { sourceGrants, delegatedGrants }
  ├─ { reused } = checkEquivalence({webId, grantee, generated, existing})   // DUMMY → { reused: [] }
  ├─ store new source grants + ACRs (skip generated grants matched by reused)
  ├─ delegatedGrantIds = requestDelegation(...) → GrantId[]
  ├─ deleteDataGrants({webId, grants: existing minus reused → GrantId[]})   // HTTP DELETE — ⚠️ COMMENTED OUT
  ├─ clearDataGrantsOnRegistration({webId, peerId: grantee})
  └─ setDataGrantsOnRegistration({webId, grantee, grants: newIds + reusedIds → GrantId[]})

// REMOVED: updateGrantsForOneAgent, updateGrantsForAuthorization, ensurePeers
```

Ordering rationale: store the new grants **before** deleting the old ones
(minimizes the window with no grants; matches the current store-before-clear
order). Deletion of old resources and the registration unlink happen before
`setDataGrantsOnRegistration`. On workflow failure Temporal retries from scratch,
so the "delete everything, store everything" step-1 semantics are safe.

### Activities (`packages/components/src/temporal/activities/grants.ts`)

**New:**

```ts
// Read the grantee's current grants from their agent registration (hasDataGrant).
// Returns [] when the registration has no grants; tolerates grants that no
// longer exist (already deleted at the data owner). (Registration itself is
// guaranteed to exist — see design decision 8.)
export async function getExistingGrants(
  payload: { webId: SocialAgentId; peerId: AgentId }
): Promise<GrantData[]>

// HTTP-DELETE grant resources using the webId's session.
// Works for source grants (in the webId's own registry) AND delegated grants
// (in data owners' registries — the dataGrantTemplate ACR grants the grantor
// acl:Write, which CSS maps to the Delete permission).
// Idempotent: 404 is tolerated (already gone). Sequential loop with the CSS race-condition comment.
export async function deleteDataGrants(
  payload: { webId: SocialAgentId; grants: GrantId[] }
): Promise<void>

// DUMMY for now: always returns { reused: [] } (pretend nothing is equivalent).
// Interface ready for the real comparison (see "Future step").
export async function checkEquivalence(payload: {
  webId: SocialAgentId
  grantee: AgentId
  generated: GeneratedGrants
  existing: GrantData[]
}): Promise<{ reused: { existing: GrantId; generated: GrantData }[] }>

// How a role is used across authorizations (single scan).
// dataOwner matching mirrors findAuthorizationsDelegatingFromOwner:
// dataOwner === roleId && grantee !== roleId (an authorization granted TO the role itself
// is not also a dataOwner-authorization of that same role).
// usedAsDataOwner is derived: affectedGrantees.length > 0.
// The producer types each grantee (SocialAgentId | ApplicationId | RoleId).
export async function findRoleUsage(payload: {
  webId: SocialAgentId
  roleId: RoleId
}): Promise<{
  usedAsGrantee: boolean
  affectedGrantees: AgentOrRoleId[]   // grantees of authorizations with dataOwner === roleId && grantee !== roleId, deduped
  authorizations: DataAuthorizationId[]  // ALL matched (grantee === roleId OR dataOwner === roleId), deduped — consumed by deleteAuthorizations
}>

// Separate deletion step — deletes the authorization resources whose IRIs come from
// findRoleUsage().authorizations (replaces deleteAuthorizationsUsingRole: usage scanning
// is findRoleUsage's job, deletion is this activity's job).
// Idempotent: 404 is tolerated (already deleted). Sequential loop with the CSS race-condition comment.
export async function deleteAuthorizations(
  payload: { webId: SocialAgentId; authorizations: DataAuthorizationId[] }
): Promise<void>
```

**Changed:**

```ts
// findAffectedAuthorizations → findAffectedGrantees
// Ports the existing matching of findAffectedAuthorizations
// (findAuthorizationsDelegatingFromOwner with optional roleId; when roleId is
// undefined — updateDelegatedGrants — the existing logic also matches
// All-scope authorizations) but returns the deduped grantees (typed, may
// include roles) instead of grouping by grantee with iris.
export async function findAffectedGrantees(
  payload: { webId: SocialAgentId; peerId: SocialAgentId; roleId?: RoleId }
): Promise<AgentOrRoleId[]>

// getAuthorizations — return typed DataAuthorizationId[] instead of string[].
export async function getAuthorizations(
  payload: { webId: SocialAgentId; peerId: AgentId }
): Promise<DataAuthorizationId[]>

// getGrantees — typed in/out: routes by type (Role → members, agent → [grantee])
// instead of registry lookups.
export async function getGrantees(payload: {
  webId: SocialAgentId
  grantee: AgentOrRoleId
}): Promise<AgentId[]>

// generateGrants — input split into its own type; dataAuthorizations: DataAuthorizationId[]
// (internally maps to iris for session.generateDataGrants).
export async function generateGrants(
  payload: { webId: SocialAgentId; grantee: AgentId; dataAuthorizations: DataAuthorizationId[] }
): Promise<GeneratedGrants>

// set/clearDataGrantsOnRegistration — typed ids.
export async function setDataGrantsOnRegistration(payload: {
  webId: SocialAgentId
  grantee: AgentId
  grants: GrantId[]
}): Promise<void>
export async function clearDataGrantsOnRegistration(payload: {
  webId: SocialAgentId
  peerId: AgentId
}): Promise<void>
```

**Unchanged:** `storeDataGrant`, `createAcr` (take `FinalGrantData`), and
`requestDelegation` — except its return becomes `GrantId[]` (maps the
delegation endpoint's response IRIs to `GrantId`).

**Removed:** `deleteAuthorizationsUsingRole` (replaced by `findRoleUsage` +
`deleteAuthorizations`), `ensurePeers` (replaced by type-based routing +
`getGrantees`).

### Types

| Type | Change |
|---|---|
| `CreateGrantsForAgentInput` | `{ webId: SocialAgentId; grantee: AgentId }` — drop `dataAuthorizationIris` |
| `CreateGrantsInput` | `{ webId: SocialAgentId; authorizationGrantee: AgentOrRoleId }` — drop `dataAuthorizationIris` |
| `GenerateGrantsInput` (new) | `{ webId: SocialAgentId; grantee: AgentId; dataAuthorizations: DataAuthorizationId[] }` |
| `GetAuthorizationsInput` | `{ webId: SocialAgentId; peerId: AgentId }` (return `DataAuthorizationId[]`) |
| `FindAffectedAuthorizationsInput` | `{ webId: SocialAgentId; peerId: SocialAgentId; roleId?: RoleId }` (return `AgentOrRoleId[]`) |
| `UpdateGrantsInput` | removed |
| `ProcessRoleMembershipChangeInput` | `{ webId: SocialAgentId; roleId: RoleId; peers: SocialAgentId[] }` |
| `RoleUsage` (new) | `{ usedAsGrantee: boolean; affectedGrantees: AgentOrRoleId[]; authorizations: DataAuthorizationId[] }` — returned by `findRoleUsage`; `usedAsDataOwner` is derived (`affectedGrantees.length > 0`) |
| `CheckEquivalenceInput` / `EquivalenceResult` (new) | see activity above |
| `*Id` (new, data-model) | `{ id: string; type: string[] }` extracted per `*Data` model, exported from index |

### Service/handler changes

| File | Change |
|---|---|
| `services/Authorization.ts` (`recordAuthorization`) | args → `{ webId: { id: saiSession.webId, type: [INTEROP.SocialAgent] }, authorizationGrantee: { id: authorization.grantee, type: [authorization.agentType] } }` (drop `dataAuthorizationIris`) |
| `services/ShareResource.ts` (`shareResource`) | per grantee args → `{ webId, authorizationGrantee: { id: grantee, type: [...] } }` — grantees are social agents in the share flow (confirm roles are not share targets); drop iris; only unique grantees needed |
| `services/RoleRegistry.ts` | `roleId: { id, type: [INTEROP.Role] }`, `peers: role.members.map(m => ({ id: m, type: [INTEROP.SocialAgent] }))` |
| `ReciprocalWebhookHandler.ts` | `webId` / `peerId` → `{ id, type: [INTEROP.SocialAgent] }` |
| `GrantIssuanceHandler.ts` | unchanged |
| `workers/main.ts` | unchanged (same `create-grants` task queue, workflow + activities files) |

## Design decisions

1. **`createGrantsForAgent` is self-contained** — callers no longer pass
   authorization IRIs; it fetches all of the grantee's authorizations itself via
   `getAuthorizations` (`findAuthorizationsForAgent`, which already resolves
   role memberships). This fixes the extend quirk at the source.
2. **Grantees are always agents** at the `createGrantsForAgent` level. Role→member
   resolution happens only where a role id is present (`createGrantsForAuthorization`
   via `getGrantees`, and type-based routing in the role workflows).
3. ⚠️ **BLOCKED — "All grants are deleted" = HTTP DELETE of the grant
   resources** using the webId's session, plus the existing registration unlink
   (`clearDataGrantsOnRegistration`). **Currently disabled**: both
   `deleteDataGrants` calls in `createGrantsForAgent` are commented out. The
   integration verification **failed with 403**:
   - `MethodModesExtractor` maps `DELETE` → `PERMISSIONS.Delete`; the
     `AclPermissionsEngine` (`@solidlab/policy-engine`) translates it to
     `acl:Write` on the **target AND the parent container**
     (`[PERMISSIONS.Delete]: { target: ACL.Write, parent: ACL.Write }`).
   - the `dataGrantTemplate` ACR grants the **grantor** `acl:Read, acl:Write`
     on the delegated grant **resource** only — the grantor has **no
     `acl:Write` on the parent grant-registry container** (owner-only ACRs), so
     the grantor's DELETE of a delegated grant in a data owner's pod is denied.
   - source grants (in the webId's own registry) are deletable by the owner
     (Write + Control on resource and container); the seed ACRs additionally
     grant delegated-grant grantors only `acl:Read` (not even resource Write).
   - open options: (a) grant the grantor `acl:Write` on the parent
     grant-registry container (privilege-heavy — would touch
     `createContainer`/templates + seed ACRs); (b) reconsider the design
     (leave delegated resources orphaned, or delete only source grants).
4. **`checkEquivalence` is a dummy now** — returns `{ reused: [] }` — but the
   workflow is fully wired for the real check: `reused` existing grants are not
   deleted, their ids are re-linked on the registration, and their generated
   counterparts are not stored.
5. **Role as grantee vs as dataOwner are treated differently.** A role can be
   used as **grantee** (members receive grants) and/or as **dataOwner** (members'
   data is granted to others) across different authorizations. `findRoleUsage`
   reports both usages as `{ usedAsGrantee, affectedGrantees }`: a boolean for
   the grantee usage (the affected members are already known as `peers`) and
   the grantees of the dataOwner-authorizations as a list (they are unknown to
   the workflow). Both `processRoleMembershipChange` and `processRoleDeletion`
   use it (the latter additionally calls `deleteAuthorizations` on its
   `authorizations` list). When used as grantee, the members (peers) are
   regenerated. When used as dataOwner, the **grantees of those authorizations**
   are regenerated — the members themselves are NOT, because their received
   grants never change (a grant is never issued on the grantee's own data);
   revocation of access to their data happens via the grantees' regeneration
   deleting the delegated resources in their pods. Both usages may apply at
   once; the affected sets are merged and deduped.

   **Both-usages example:** role `biz` is grantee of `A1` (grantee: biz,
   dataOwner: alice) and dataOwner of `A2` (grantee: whiz, dataOwner: biz,
   `AllFromRole`). `findRoleUsage` returns `{ usedAsGrantee: true,
   affectedGrantees: [whiz], authorizations: [A1, A2] }`. The workflows then
   regenerate `biz`'s members (grantees of A1) ∪ whiz's members (grantees of
   A2, via `getGrantees`); a member in both sets is regenerated once.
6. **Deny case** handled inside `createGrantsForAgent` — zero authorizations →
   delete all existing grants + clear registration (replaces the special case in
   the removed `updateGrantsForOneAgent`).
7. **`processRoleDeletion` does not delegate to `processRoleMembershipChange`** —
   it calls `findRoleUsage` **before** deleting (the usage info and the matched
   authorization ids must be captured while the authorizations still exist),
   then a separate `deleteAuthorizations` step deletes those ids, and finally
   it computes the affected agents directly: `role.members` (from the service,
   if usedAsGrantee) ∪ the type-routed `affectedGrantees`. Usage scanning and
   deletion are separate single-purpose activities.
8. **Registration invariant (grantees always registered):** every role member
   has a `SocialAgentRegistration` in the agent registry of the webId running
   the workflow — roles can only contain members that have such registrations
   (enforced by the domain model). All grantees reachable from these workflows
   therefore have an agent registration, so the deny path's
   `clearDataGrantsOnRegistration` never hits "registration does not exist".
9. **Typed ids at every boundary (`*Id`).** Bare IRI strings are replaced by
   `{ id, type: string[] }` objects everywhere an id crosses a workflow/activity
   boundary. Producers determine `type`; consumers branch on it (Role → members
   via `getGrantees`, agent types → as-is) — which removes `ensurePeers` and
   makes payloads self-documenting. The `*Id` interfaces are extracted from the
   existing `*Data` models in `packages/data-model` (`*Data = *Id & { rest }`).
10. **Workflow code must not import runtime dependencies.** Temporal bundles
    workflow code and rejects disallowed Node built-ins (`buffer`, `events`,
    `process`). An early version of `workflows/grants.ts` imported `INTEROP`
    (value) from `@janeirodigital/interop-utils`, which pulled those in and
    crashed the worker at bundle validation ("Your Workflow code is importing
    the following disallowed modules"). The role-type check now uses a local
    `ROLE_TYPE` string constant instead. Activities are NOT affected (they run
    in the worker's Node context, not the sandbox).

## Migration order

1. ✅ **data-model**: for every `*Data` model with `id` + `type`, extract the
   matching `*Id` (`*Data = *Id & { ...rest }`), keep optional `id` optional
   (`GrantData`, `DataAuthorizationData`), export all `*Id` types from the index.
2. ✅ **Activities** (`activities/grants.ts`): add `getExistingGrants`,
   `deleteDataGrants`, `checkEquivalence` (dummy), `findRoleUsage`,
   `deleteAuthorizations`; rename/rework `findAffectedAuthorizations` →
   `findAffectedGrantees`; retype `getAuthorizations`, `getGrantees`,
   `generateGrants`, `set/clearDataGrantsOnRegistration` to `*Id`; **remove**
   `deleteAuthorizationsUsingRole` and `ensurePeers`; `requestDelegation`
   returns `GrantId[]`.
3. ✅ **Workflows** (`workflows/grants.ts`): rewrite `createGrantsForAgent`
   (self-contained, phases: fetch → generate → checkEquivalence → store →
   delete → register); rewrite `createGrantsForAuthorization`,
   `updateDelegatedGrants`, `processRoleMembershipChange`,
   `processRoleDeletion` (type-based routing); remove
   `updateGrantsForOneAgent`, `updateGrantsForAuthorization`.
4. ✅ **Services** (`Authorization.ts`, `ShareResource.ts`, `RoleRegistry.ts`,
   `ReciprocalWebhookHandler.ts`): drop `dataAuthorizationIris`; construct
   `*Id` workflow args.
5. ✅ **Docs**: rewrite `docs/plans/workflow-temporal-decupling.md` to the target
   workflow set.
6. ✅ **Verify**: `pnpm typecheck` + integration tests
   (`test/authorization.test.ts`, `test/roles.test.ts` — see below) — typecheck
   passes and `test/` passes (with the deletion caveat, design decision 3).

## Tests

- `test/authorization.test.ts` — denied flow (grantee gets no authorizations →
  existing grants deleted). Should pass unchanged.
- `test/roles.test.ts` — role membership add/remove (incl. `AllFromRole`,
  delete grantee-role, delete dataOwner-role). Should pass unchanged; these
  exercise the role-as-dataOwner phase and the full-regeneration path.
- New/updated test to cover the **extend flow** (record an authorization, extend
  it, verify grants from kept authorizations survive) — was broken before.
- ⚠️ Verify in integration that: delegated grant resources are actually
  DELETE-able by the grantor's session — **FAILED with 403**: the grantor has
  `acl:Write` on the grant resource (template) but not on the parent
  grant-registry container (the CSS `AclPermissionsEngine` requires both for
  DELETE). Deletion is commented out until resolved (see design decision 3).

## Future step (after this plan)

Implement real `checkEquivalence` — **now tracked in
[`check-equivalence.md`](check-equivalence.md)** (extracted from this plan's
future step; Phase 4.5 of `workflow-temporal-decupling.md`). Summary:

- Compare each generated grant (source + delegated, **including child grant
  trees** — `hasInheritingGrant` / `inheritsFromGrant`) against existing grants
  field-by-field: `grantee`, `grantedBy`, `dataOwner`, `registeredShapeTree`,
  `hasDataRegistration`, `hasStorage`, `scopeOfGrant`, `accessMode`,
  `creatorAccessMode`, `hasDataInstance`, `inheritsFromGrant`, children —
  `delegationOfGrant` excluded for delegated grants (it is a freshly generated
  IRI each run).
- Return `reused: { existing: GrantId, generated }[]`. The workflow then: skips
  storing the generated counterpart, skips deleting the existing grant, and
  re-links the existing id on the registration (its ACR stays in place).
- The workflow needs no further changes — it is already wired for this.

## Out of scope

- Whole-registry regeneration (future recovery scenarios only).
- Revocation of delegated grants at the data owner beyond HTTP-DELETE of the
  grant resource (no separate "delegation revocation" endpoint today; the
  grantor's ACR Write on the delegated grant resource is what enables the DELETE).
