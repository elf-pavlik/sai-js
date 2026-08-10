# Plan: Remove indirection between AgentRegistration and DataGrants

## Current Architecture

```
AgentRegistration (CRUDAgentRegistration)
  └─ hasAccessGrant ──► AccessGrant (ReadableAccessGrant / ImmutableAccessGrant)
                          ├─ hasDataGrant ──► DataGrant[]
                          ├─ granted: boolean (true/false)
                          └─ hasAccessNeedGroup (tracking which access need group)
```

**The Problem:** AgentRegistrations (both ApplicationRegistration and SocialAgentRegistration) currently point to an AccessGrant resource via `hasAccessGrant`. The AccessGrant in turn holds the actual DataGrants (via `hasDataGrant`), a `granted` boolean, and `hasAccessNeedGroup`. This indirection adds complexity without clear benefit.

## Target Architecture

```
AgentRegistration (CRUDAgentRegistration)
  └─ hasDataGrant ──► DataGrant[]  (directly, both local and delegated)
```

- No more AccessGrant resource or class
- `granted` is computed: `hasDataGrant` count === 0 → not granted, > 0 → granted
- No lazy caching of data grants — fetch every time via async function
- Losing `hasAccessNeedGroup` tracking (acknowledged trade-off)

## Scope of Changes

### Packages Affected

| Package | Files | Status |
|---------|-------|--------|
| `packages/data-model` | `crud/agent-registration.ts`, `crud/social-agent-registration.ts`, `crud/application-registration.ts`, `readable/application-registration.ts`, `readable/access-grant.ts`, `readable/data-authorization.ts`, `immutable/access-grant.ts`, `base-factory.ts`, `authorization-agent-factory.ts`, `readable/index.ts`, `immutable/index.ts`, `crud/index.ts`, `index.ts` | ✅ |
| `packages/authorization-agent` | `authorization-agent.ts` | ✅ |
| `packages/components` | `services/Authorization.ts`, `services/AgentRegistry.ts`, `services/DataRegistry.ts`, `temporal/activities/grants.ts`, `temporal/workflows/grants.ts` | ✅ |
| `packages/application` | `application.ts` | ✅ |
| Tests | Multiple test files (see below) | ⏳ |

---

## Detailed Changes

### 1. `packages/data-model/src/crud/agent-registration.ts` — CRUDAgentRegistration ✅

**Change `AgentRegistrationData` type:**
- Replace `hasAccessGrant?: string` with `hasDataGrant?: string[]`

**Remove:**
- `accessGrant?: ReadableAccessGrant` instance property
- `buildAccessGrant()` method — no longer needed
- `setAccessGrant(accessGrantIri)` method — replaced with functions to manage `hasDataGrant` directly
- `unsetAccessGrant()` method — replaced with functions to manage `hasDataGrant` directly
- `get hasAccessGrant(): string | undefined` getter — replaced with functions
- Any references to `INTEROP.hasAccessGrant`

**Add (as standalone exported functions):**
- `addDataGrant`, `removeDataGrant`, `removeAllDataGrants`
- `getDataGrantIris`, `getDataGrants`, `getGranted`

**Update `datasetFromData()`:**
- Use `hasDataGrant` (array) instead of `hasAccessGrant` (single string)

### 2. `packages/data-model/src/crud/social-agent-registration.ts` — CRUDSocialAgentRegistration ✅

**Bootstrap changes:**
- Remove `await this.buildAccessGrant()` from bootstrap

### 3. `packages/data-model/src/crud/application-registration.ts` — CRUDApplicationRegistration ✅

**Bootstrap changes:**
- Remove `await this.buildAccessGrant()` from bootstrap

### 4. `packages/data-model/src/readable/application-registration.ts` — ReadableApplicationRegistration ✅

**Remove:**
- `hasAccessGrant: ReadableAccessGrant` property
- `buildAccessGrant()` method

**Add:**
- `async getDataGrants(): Promise<DataGrant[]>` method
- `get granted(): boolean` getter

### 5. `packages/data-model/src/mixins/agent-registration-getters.ts` — No Changes Needed

### 6. `packages/data-model/src/readable/data-authorization.ts` — ReadableDataAuthorization ✅

Changed delegation logic to use `getDataGrantIris` / `getDataGrants` instead of accessing `reciprocalRegistration?.accessGrant`.

### 7. `packages/data-model/src/immutable/access-grant.ts` — ImmutableAccessGrant ✅

**Removed entirely.** File deleted.

### 8. `packages/data-model/src/readable/access-grant.ts` — ReadableAccessGrant ✅

**Removed entirely.** File deleted.

### 9. `packages/data-model/src/base-factory.ts` — BaseFactory ✅

**Remove:**
- `accessGrant` method from `BaseReadableFactory` interface and its implementation

### 10. `packages/data-model/src/authorization-agent-factory.ts` — AuthorizationAgentFactory ✅

**Remove:**
- `accessGrant` from `ImmutableFactory` interface and its implementation

### 11. `packages/authorization-agent/src/authorization-agent.ts` — AuthorizationAgent ✅

Updated `findResourceServerOwner` and `findGrantForResource` to use `getDataGrants` / `getDataGrantIris`. Changed `generateAccessGrant` return type to `GeneratedGrants`.

### 12. `packages/components/src/services/Authorization.ts` ✅

Updated `findSocialAgentDataRegistrations` to use `getDataGrantIris` / `getDataGrants`.

### 13. `packages/components/src/services/AgentRegistry.ts` ✅

- Removed `accessGrant` from `buildSocialAgentProfile`
- Updated `getSocialAgents` to use `getDataGrantIris` / `getDataGrants`

### 14. `packages/components/src/services/DataRegistry.ts` ✅

Updated `findDataGrantIndex` and `getDataRegistries` to use `getDataGrantIris` / `getDataGrants`.

### 15. `packages/components/src/temporal/activities/grants.ts` ✅

- `storeAccessGrant` → removed (kept as stub)
- `setAccessGrant` → replaced with `setDataGrantsOnRegistration`
- `unsetAccessGrant` → replaced with `clearDataGrantsOnRegistration`
- `generateGrants` → now returns `GeneratedGrants` (no AccessGrant wrapper)

### 16. `packages/components/src/temporal/workflows/grants.ts` ✅

- `updateGrantsForOneAgent`: now calls `clearDataGrantsOnRegistration` instead of `unsetAccessGrant`
- `createGrantsForAgent`: no longer creates/stores AccessGrant; directly adds data grant IRIs to AgentRegistration

### 17. `packages/data-model/src/readable/access-authorization.ts` — ReadableAccessAuthorization ✅

`generateAccessGrant` now returns `GeneratedGrants` (just `sourceGrants` and `delegatedGrants`), no `AccessGrantData` dependency.

### 18. `packages/application/src/application.ts` ✅

- `dataOwners` getter replaced with `getDataOwnersAsync()` method
- Updated vuejectron example's `checkAuthorization`

### 19. Types/Interfaces to update ✅

**Removed:**
- `AccessGrantData`, `FinalAccessGrantData` (via deleted files)
- `ImmutableAccessGrant`, `ReadableAccessGrant` classes
- `accessGrant` from all factory interfaces

### 20. Test Files ⏳

Skipped per instructions. Builds pass, so tests should compile after updates.

---

## Key Functions to Create (Functional Approach)

Following the stated goal of moving to a functional approach (functions instead of `this`-based methods), all new operations on AgentRegistration are standalone exported functions:

### In `packages/data-model/src/crud/agent-registration.ts`:

```ts
// Manage hasDataGrant triples on the AgentRegistration resource

export async function addDataGrant(
  registration: CRUDAgentRegistration,
  grantIri: string
): Promise<void>

export async function removeDataGrant(
  registration: CRUDAgentRegistration,
  grantIri: string
): Promise<void>

export async function removeAllDataGrants(
  registration: CRUDAgentRegistration
): Promise<void>

// Read data grants (synchronous, from dataset)

export function getDataGrantIris(
  registration: CRUDAgentRegistration
): string[]

// Fetch full DataGrant resources (async, no caching)

export async function getDataGrants(
  registration: CRUDAgentRegistration
): Promise<DataGrant[]>

// Check if granted

export function getGranted(
  registration: CRUDAgentRegistration
): boolean
```

### In `packages/components/src/temporal/activities/grants.ts`:

```ts
// Replace setAccessGrant
export async function setDataGrantsOnRegistration(
  payload: { webId: string; grantee: string; grantIris: string[] }
): Promise<void>

// Replace unsetAccessGrant  
export async function clearDataGrantsOnRegistration(
  payload: { webId: string; peerId: string }
): Promise<void>
```

---

## Migration Order

### ✅ Done

1. **data-model package** (core types, classes, exports) ✅
   - Remove `immutable/access-grant.ts`, `readable/access-grant.ts`
   - Update `crud/agent-registration.ts` — new types, remove old methods, add new functions
   - Update `crud/social-agent-registration.ts` and `crud/application-registration.ts` — bootstrap changes
   - Update `readable/application-registration.ts` — new `getDataGrants()` method
   - Update `readable/data-authorization.ts` — delegation logic
   - Update `readable/access-authorization.ts` — `generateAccessGrant` simplification
   - Update factories (`base-factory.ts`, `authorization-agent-factory.ts`)
   - Update all index.ts exports

2. **authorization-agent package** ✅
   - Update `authorization-agent.ts` — use new functions

3. **components package** ✅
   - Update `services/Authorization.ts`, `services/AgentRegistry.ts`, `services/DataRegistry.ts`
   - Update `temporal/activities/grants.ts` — replace `setAccessGrant`/`unsetAccessGrant`/`storeAccessGrant`
   - Update `temporal/workflows/grants.ts` — adapt workflow

4. **application package** ✅
   - Update `application.ts` — use new `getDataGrants()` method

6. **examples** ✅
   - Update vuejectron example

### ⏳ Not Done (tests only — skipped per instructions)

5. **tests**
   - Remove obsolete tests
   - Update remaining tests

---

## Key Design Decisions (Confirmed)

1. **AccessGrant is completely removed** — both `ImmutableAccessGrant` and `ReadableAccessGrant` classes, their types, and all related exports. No more AccessGrant resources created or read.

2. **Lazy async data grant access** — no caching. Every call to `getDataGrants()` fetches the DataGrant resources fresh.

3. **Granted is computed** — `getGranted()` returns `getDataGrantIris().length > 0`. No stored boolean.

4. **Functional approach** — new operations on AgentRegistration are standalone exported functions taking the instance as parameter, not methods on the class.

5. **We lose tracking of which access need group a grant was for** — the `hasAccessNeedGroup` on AccessGrant is not migrated. This is an accepted trade-off.
