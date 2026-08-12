# Temporal Workflow Start/Execute Locations (post-refactor)

> **Status:** current state — `refactor-grants-workflows.md` is implemented and
> `test/` passes. ⚠️ The HTTP-DELETE of old grant resources in
> `createGrantsForAgent` is **commented out** pending a 403 on grantor-side
> deletion of delegated grants (see `refactor-grants-workflows.md`, design
> decision 3).
> All places in this codebase where a Temporal workflow is started or executed
> via a Temporal client (`@temporalio/client`).

## Client Wrapper

**`packages/components/src/temporal/client.ts`** — Custom `Temporal` class wrapping `@temporalio/client`. Creates a `Connection` and a `Client` on `init()`.

---

## 1. Reciprocal Webhook Handler (fire-and-forget)

**File**: `packages/components/src/ReciprocalWebhookHandler.ts`

```ts
if (requestBody.type === 'Update') {
  const temporal = new Temporal()
  await temporal.init()
  await temporal.client.workflow.start(updateDelegatedGrants, {
    taskQueue: 'create-grants',
    args: [{
      webId: { id: channel.webId, type: [INTEROP.SocialAgent] },
      peerId: { id: channel.peerId, type: [INTEROP.SocialAgent] },
    }],
    workflowId: crypto.randomUUID(),
  })
}
```

| Property | Value |
|---|---|
| Method | `workflow.start` (fire-and-forget) |
| Workflow | `updateDelegatedGrants` |
| Task Queue | `create-grants` |
| Context | When a reciprocal webhook notification with type `Update` is received, finds the affected grantees (of authorizations where the peer is the data owner) and fully regenerates their grants. |

---

## 2. ShareResource Service (fire-and-forget)

**File**: `packages/components/src/services/ShareResource.ts`

```ts
const temporal = new Temporal()
await temporal.init()
await Promise.all(
  grantees.map((grantee) =>
    temporal.client.workflow.start(createGrantsForAuthorization, {
      taskQueue: 'create-grants',
      args: [{
        webId: { id: saiSession.webId, type: [INTEROP.SocialAgent] },
        authorizationGrantee: { id: grantee, type: [INTEROP.SocialAgent] },
      }],
      workflowId: crypto.randomUUID(),
    })
  )
)
```

| Property | Value |
|---|---|
| Method | `workflow.start` (fire-and-forget) |
| Workflow | `createGrantsForAuthorization` |
| Task Queue | `create-grants` |
| Context | After sharing a data instance, one workflow per affected grantee is started. The workflow resolves roles to members and fully regenerates each agent's grants. No authorization IRIs are passed — regeneration is always "all authorizations of the grantee". |

---

## 3. RoleRegistry Service — update (awaits completion)

**File**: `packages/components/src/services/RoleRegistry.ts`

```ts
const temporal = new Temporal()
await temporal.init()
await temporal.client.workflow.execute(processRoleMembershipChange, {
  taskQueue: 'create-grants',
  args: [{
    webId: { id: saiSession.webId, type: [INTEROP.SocialAgent] },
    roleId: { id, type: [INTEROP.Role] },
    peers: affected.map((peer) => ({ id: peer, type: [INTEROP.SocialAgent] })),
  }],
  workflowId: crypto.randomUUID(),
})
```

| Property | Value |
|---|---|
| Method | `workflow.execute` (awaits completion) |
| Workflow | `processRoleMembershipChange` |
| Task Queue | `create-grants` |
| Context | When a role is updated and the member set changes: regenerates all grants for each affected peer (agent), plus all grantees of authorizations that use the role as `dataOwner`. |

---

## 4. RoleRegistry Service — delete (awaits completion)

**File**: `packages/components/src/services/RoleRegistry.ts`

```ts
const temporal = new Temporal()
await temporal.init()
await temporal.client.workflow.execute(processRoleDeletion, {
  taskQueue: 'create-grants',
  args: [{
    webId: { id: saiSession.webId, type: [INTEROP.SocialAgent] },
    roleId: { id, type: [INTEROP.Role] },
    peers: role.members.map((member) => ({ id: member, type: [INTEROP.SocialAgent] })),
  }],
  workflowId: crypto.randomUUID(),
})
```

| Property | Value |
|---|---|
| Method | `workflow.execute` (awaits completion) |
| Workflow | `processRoleDeletion` |
| Task Queue | `create-grants` |
| Context | When a role is deleted, removes its authorizations and regenerates grants for all former members (and grantees of deleted role-data authorizations). |

---

## 5. Authorization Service (awaits completion)

**File**: `packages/components/src/services/Authorization.ts`

```ts
const temporal = new Temporal()
await temporal.init()
await temporal.client.workflow.execute(createGrantsForAuthorization, {
  taskQueue: 'create-grants',
  args: [{
    webId: { id: saiSession.webId, type: [INTEROP.SocialAgent] },
    authorizationGrantee: { id: authorization.grantee, type: [authorization.agentType] },
  }],
  workflowId: crypto.randomUUID(),
})
```

| Property | Value |
|---|---|
| Method | `workflow.execute` (awaits completion) |
| Workflow | `createGrantsForAuthorization` |
| Task Queue | `create-grants` |
| Context | When an access authorization is recorded (granted or denied), regenerates the full grant set for the grantee. No authorization IRIs are passed — the workflow resolves the grantee (agent or role) to agents and each agent's grants are fully regenerated from all of its authorizations. |

---

## Referenced Workflow Definitions

All workflows are defined in **`packages/components/src/temporal/workflows/grants.ts`**:

| Exported Workflow | Purpose |
|---|---|
| `createGrantsForAuthorization` | Entry point: resolves the grantee (agent or role) via `getGrantees`, spawns `createGrantsForAgent` per resolved agent |
| `createGrantsForAgent` | **Core, self-contained**: fetches all authorizations of the agent (incl. via roles), generates all grants, `checkEquivalence` (dummy → reuse nothing), stores new grants + ACRs, requests delegations, ⚠️ HTTP-DELETEs old grant resources (currently commented out — see plan design decision 3), updates the registration |
| `processRoleMembershipChange` | Regenerates grants for affected peers when the role is used as **grantee** (`findRoleUsage`), and for the grantees of authorizations using the role as **dataOwner** (typed by `findRoleUsage`, role-grantees resolved via `getGrantees`) when used as such. Both usages can apply at once; sets are merged and deduped |
| `processRoleDeletion` | Scans role usage via `findRoleUsage` (before deletion), deletes the role's authorizations via `deleteAuthorizations` (grantee **or** dataOwner — from `usage.authorizations`), regenerates `role.members` (if used as grantee — they are the grantees, unresolvable after deletion) ∪ the type-routed grantees of the dataOwner-authorizations (via `getGrantees`). Does **not** delegate to `processRoleMembershipChange` |
| `updateDelegatedGrants` | Finds affected grantees (of authorizations where the peer is data owner), delegates to `createGrantsForAuthorization` per grantee |
| `storeGrant` | Stores grant data and creates ACRs (data-owner side, incoming delegations) |

**Removed in the refactor:** `updateGrantsForOneAgent`, `updateGrantsForAuthorization`, `ensurePeers`.

Additional workflows exist at:
- **`packages/components/src/temporal/workflows/reciprocal.ts`** — `establishReciprocal`
- **`packages/components/src/temporal/workflows/forward-to-push.ts`** — `forwardToPush`
