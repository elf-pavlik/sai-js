# Temporal Workflow Start/Execute Locations

All places in this codebase where a Temporal workflow is started or executed via a Temporal client (`@temporalio/client`).

## Client Wrapper

**`packages/components/src/temporal/client.ts`** — Custom `Temporal` class wrapping `@temporalio/client`. Creates a `Connection` and a `Client` on `init()`.

---

## 1. Reciprocal Webhook Handler (fire-and-forget)

**File**: `packages/components/src/ReciprocalWebhookHandler.ts` (lines 46–57)

```ts
if (requestBody.type === 'Update') {
  const temporal = new Temporal()
  await temporal.init()
  await temporal.client.workflow.start(updateDelegatedGrants, {
    taskQueue: 'create-grants',
    args: [{ webId: channel.webId, peerId: channel.peerId }],
    workflowId: crypto.randomUUID(),
  })
}
```

| Property | Value |
|---|---|
| Method | `workflow.start` (fire-and-forget) |
| Workflow | `updateDelegatedGrants` |
| Task Queue | `create-grants` |
| Context | When a reciprocal webhook notification with type `Update` is received, starts a workflow to find affected authorizations and update their grants. |

---

## 2. ShareResource Service (fire-and-forget)

**File**: `packages/components/src/services/ShareResource.ts` (lines 52–64)

```ts
const temporal = new Temporal()
await temporal.init()
await Promise.all(
  authorizationIris.map((authorizationIri) =>
    temporal.client.workflow.start(createGrantsForAuthorization, {
      taskQueue: 'create-grants',
      args: [{ authorizationId: authorizationIri, webId: saiSession.webId }],
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
| Context | After sharing a data instance, one workflow per authorization is started to create grants for that authorization. |

---

## 3. RoleRegistry Service — update (awaits completion)

**File**: `packages/components/src/services/RoleRegistry.ts` (lines 43–48)

```ts
const temporal = new Temporal()
await temporal.init()
await temporal.client.workflow.execute(processRoleMembershipChange, {
  taskQueue: 'create-grants',
  args: [{ webId: saiSession.webId, roleId: id, peers: affected }],
  workflowId: crypto.randomUUID(),
})
```

| Property | Value |
|---|---|
| Method | `workflow.execute` (awaits completion) |
| Workflow | `processRoleMembershipChange` |
| Task Queue | `create-grants` |
| Context | When a role is updated and the member set changes, updates grants for affected peers. |

---

## 4. RoleRegistry Service — delete (awaits completion)

**File**: `packages/components/src/services/RoleRegistry.ts` (lines 66–72)

```ts
const temporal = new Temporal()
await temporal.init()
await temporal.client.workflow.execute(processRoleDeletion, {
  taskQueue: 'create-grants',
  args: [{ webId: saiSession.webId, roleId: id, peers: role.members }],
  workflowId: crypto.randomUUID(),
})
```

| Property | Value |
|---|---|
| Method | `workflow.execute` (awaits completion) |
| Workflow | `processRoleDeletion` |
| Task Queue | `create-grants` |
| Context | When a role is deleted, removes authorizations and updates grants for former members. |

---

## 5. Authorization Service (awaits completion)

**File**: `packages/components/src/services/Authorization.ts` (lines 309–316)

```ts
const temporal = new Temporal()
await temporal.init()
await temporal.client.workflow.execute(createGrantsForAuthorization, {
  taskQueue: 'create-grants',
  args: [{ authorizationId: recorded.iri, webId: saiSession.webId }],
  workflowId: crypto.randomUUID(),
})
```

| Property | Value |
|---|---|
| Method | `workflow.execute` (awaits completion) |
| Workflow | `createGrantsForAuthorization` |
| Task Queue | `create-grants` |
| Context | When an access authorization is recorded, generates the necessary data grants. |

---

## Referenced Workflow Definitions

All workflows are defined in **`packages/components/src/temporal/workflows/grants.ts`**:

| Exported Workflow | Purpose |
|---|---|
| `createGrantsForAuthorization` | Entry point: fetches grantees, spawns child workflows for each grantee |
| `createGrantsForAgent` | Generates and stores data grants + ACRs for one agent |
| `processRoleMembershipChange` | Updates grants for peers when role membership changes |
| `processRoleDeletion` | Removes authorizations linked to a role, delegates to `processRoleMembershipChange` |
| `updateGrantsForOneAgent` | Fetches current authorizations and updates grants for a single agent |
| `updateGrantsForAuthorization` | Triggers `createGrantsForAuthorization` for a specific authorization (used in delegation updates) |
| `updateDelegatedGrants` | Finds affected authorizations and updates their grants |
| `storeGrant` | Stores grant data and creates ACRs |

Additional workflows exist at:
- **`packages/components/src/temporal/workflows/reciprocal.ts`** — `establishReciprocal`
- **`packages/components/src/temporal/workflows/forward-to-push.ts`** — `forwardToPush`
