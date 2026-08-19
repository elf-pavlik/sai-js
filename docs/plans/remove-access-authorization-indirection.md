# Plan: Remove indirection between AuthorizationRegistry and DataAuthorizations

> **Status: implemented** (commit `c6527fb3 authorizations as pojos`). Statuses below
> reflect what was done. The remaining unit-test migration (see §13) was completed by the later data-model refactors.

## Current Architecture

```
AuthorizationRegistry (CRUDAuthorizationRegistry)
  └─ hasAccessAuthorization ──► AccessAuthorization (ReadableAccessAuthorization / ImmutableAccessAuthorization)
                                  ├─ hasDataAuthorization ──► DataAuthorization[] (ReadableDataAuthorization / ImmutableDataAuthorization)
                                  ├─ granted: boolean (true/false)
                                  ├─ grantedBy, grantedWith, grantee
                                  └─ hasAccessNeedGroup (tracking which access need group)
```

**The Problem:** The AuthorizationRegistry currently points to an AccessAuthorization resource via `hasAccessAuthorization`. The AccessAuthorization in turn holds the actual DataAuthorizations (via `hasDataAuthorization`), a `granted` boolean, and access-authorization-level metadata (`grantedBy`, `grantedWith`, `grantee`, `hasAccessNeedGroup`). This indirection adds complexity without clear benefit — the DataAuthorizations already carry `grantee`, `grantedBy`, and `dataOwner` themselves.

## Target Architecture

```
AuthorizationRegistry (CRUDAuthorizationRegistry)
  └─ hasDataAuthorization ──► DataAuthorization[] (directly)
```

- No more AccessAuthorization resource or class
- `granted` is computed: `getDataAuthorizationIris().length === 0` → not granted, `> 0` → granted
- No lazy caching of data authorizations — fetch every time via async functions
- Losing `grantedWith` (agentId) and `hasAccessNeedGroup` tracking (acknowledged trade-offs)

This mirrors the completed `remove-access-grant-indirection.md` migration: the grants analog removed the AccessGrant wrapper between AgentRegistration and DataGrants; here we remove the AccessAuthorization wrapper between AuthorizationRegistry and DataAuthorizations.

## Scope of Changes

| Package | Files | Status |
|---------|-------|--------|
| `packages/data-model` | `jsonld-utils.ts` (new), `grant.ts`, `data-authorization.ts` (new), `data-authorization-context.ts` (new), `crud/authorization-registry.ts`, `authorization-agent-factory.ts`, `readable/access-authorization.ts` (delete), `readable/data-authorization.ts` (delete), `immutable/access-authorization.ts` (delete), `immutable/data-authorization.ts` (delete), `readable/index.ts`, `immutable/index.ts`, `crud/index.ts`, `index.ts` | ✅ |
| `packages/authorization-agent` | `authorization.ts`, `authorization-agent.ts` | ✅ |
| `packages/components` | `services/Authorization.ts`, `services/ShareResource.ts`, `temporal/activities/grants.ts`, `temporal/workflows/grants.ts` | ✅ |
| `packages/api-messages` | `effect.ts` — `AccessAuthorization` response changes to an array of recorded data authorizations (see Design Decisions #8) | ✅ |
| Tests | Integration tests (`test/roles.test.ts`, `test/authorization.test.ts`) updated; unit tests migrated as part of the later data-model refactors (see §13) | ✅ |

---

## Part 0: Extract general JSON-LD functionality from `grant.ts` ✅

Extract the context-agnostic JSON-LD machinery currently living in `packages/data-model/src/grant.ts` so it can be reused by the new `data-authorization.ts` module. **Done** — `jsonld-utils.ts` created; `grant.ts` refactored to delegate (public API unchanged).

### New file: `packages/data-model/src/jsonld-utils.ts` ✅

Moved from `grant.ts`, parameterized by an explicit JSON-LD context instead of the hardcoded `grantContext`:

```ts
import type { DatasetCore, Quad } from '@rdfjs/types'
import * as jsonldNs from 'jsonld'
import { Store } from 'n3'

// CJS/ESM interop (moved as-is from grant.ts)
const jsonld = (jsonldNs as any).default ?? jsonldNs

export type JsonLdContext = Record<string, unknown>

/** Build a frame resolving the node at `iri` with @embed: '@never' on every
 *  context property (generalized from buildGrantFrame). */
export function buildFrame(context: JsonLdContext, iri: string): Record<string, unknown>

/** jsonld.fromRDF + frame; throws if the node is not in the framed output.
 *  Used by grant.fromDataset / dataAuthorization.fromDataset. */
export async function frameDataset(
  dataset: DatasetCore,
  context: JsonLdContext,
  iri: string
): Promise<Record<string, unknown>>

/** jsonld.frame on a JSON-LD document (expanded/compacted/flattened);
 *  throws if the node is not in the framed output.
 *  Used by grant.fromJsonLd / dataAuthorization.fromJsonLd. */
export async function frameDoc(
  doc: unknown,
  context: JsonLdContext,
  iri: string
): Promise<Record<string, unknown>>

/** jsonld.toRDF + collect quads into an N3 Store.
 *  Used by grant.toDataset / dataAuthorization.toDataset. */
export async function toStore(doc: Record<string, unknown>, base?: string): Promise<Store>

/** Attach a context to a node POJO.
 *  Used by grant.toJsonLd / dataAuthorization.toJsonLd. */
export function withContext(context: JsonLdContext, node: Record<string, unknown>): Record<string, unknown>
```

### `packages/data-model/src/grant.ts` — refactor ✅

`grant.ts` keeps its public API unchanged (`fromDataset`, `fromJsonLd`, `toDataset`, `toJsonLd`, `GrantData`, `FinalGrantData`, behavior functions). Internally it delegates to `jsonld-utils`:

```ts
// before
const expanded = await jsonld.fromRDF(dataset)
const framed = await jsonld.frame(expanded, buildGrantFrame(iri))
if (!(framed as any).id && !(framed as any)['@id']) throw new Error(`Node ${iri} not found in framed output`)
return compactNodeToGrantData(framed as any)

// after
return compactNodeToGrantData(await frameDataset(dataset, grantContext, iri))
```

- `buildGrantFrame(iri)` is deleted (generalized into `buildFrame(context, iri)`).
- `compactNodeToGrantData(node)` stays grant-specific.
- `toJsonLd` becomes `withContext(grantContext, grant)`.
- The `jsonld` import + CJS/ESM interop line moves to `jsonld-utils.ts`.
- `GeneratedGrants` type now lives in `grant.ts` (it references `FinalGrantData`/`GrantData`).

---

## Part 1: DataAuthorization as a POJO (mirror of grant.ts) ✅

To link DataAuthorizations directly from the registry we read them as plain objects, exactly like DataGrants became `GrantData` POJOs in the previous migration.

### New file: `packages/data-model/src/data-authorization-context.ts` ✅

Mirror of `grant-context.ts`, based on the predicates previously written by `immutable/data-authorization.ts`:

```ts
export default {
  id: '@id',
  type: '@type',

  grantee: { '@id': 'http://www.w3.org/ns/solid/interop#grantee', '@type': '@id' },
  grantedBy: { '@id': 'http://www.w3.org/ns/solid/interop#grantedBy', '@type': '@id' },
  dataOwner: { '@id': 'http://www.w3.org/ns/solid/interop#dataOwner', '@type': '@id' },
  registeredShapeTree: { '@id': 'http://www.w3.org/ns/solid/interop#registeredShapeTree', '@type': '@id' },
  scopeOfAuthorization: { '@id': 'http://www.w3.org/ns/solid/interop#scopeOfAuthorization', '@type': '@id' },
  hasDataRegistration: { '@id': 'http://www.w3.org/ns/solid/interop#hasDataRegistration', '@type': '@id' },
  satisfiesAccessNeed: { '@id': 'http://www.w3.org/ns/solid/interop#satisfiesAccessNeed', '@type': '@id' },
  inheritsFromAuthorization: { '@id': 'http://www.w3.org/ns/solid/interop#inheritsFromAuthorization', '@type': '@id' },

  accessMode: { '@id': 'http://www.w3.org/ns/solid/interop#accessMode', '@type': '@id', '@container': '@set' },
  creatorAccessMode: { '@id': 'http://www.w3.org/ns/solid/interop#creatorAccessMode', '@type': '@id', '@container': '@set' },
  hasDataInstance: { '@id': 'http://www.w3.org/ns/solid/interop#hasDataInstance', '@type': '@id', '@container': '@set' },

  hasInheritingAuthorization: {
    '@reverse': 'http://www.w3.org/ns/solid/interop#inheritsFromAuthorization',
    '@container': '@set',
    '@type': '@id',
  },
}
```

### New file: `packages/data-model/src/data-authorization.ts` ✅

Replaces both `readable/data-authorization.ts` (read side) and `immutable/data-authorization.ts` (write side). Structure mirrors `grant.ts`:

```ts
/** Plain JSON representation of a Data Authorization. */
export type DataAuthorizationData = {
  /** IRI of the data authorization resource; absent until assigned by the registry */
  id?: string

  // String properties (single-value named nodes)
  grantee: string
  grantedBy: string
  registeredShapeTree: string
  scopeOfAuthorization: string
  dataOwner?: string
  hasDataRegistration?: string
  satisfiesAccessNeed?: string
  inheritsFromAuthorization?: string // parent data authorization IRI (Inherited scope)

  // Array properties (multi-value named nodes)
  accessMode: string[]
  creatorAccessMode?: string[]
  hasDataInstance?: string[]

  // Children discovered via inverse quads in the dataset (lazily resolved)
  hasInheritingAuthorization?: string[] // child data authorization IRIs
}

/** A data authorization that has been assigned its IRI. */
export type FinalDataAuthorizationData = DataAuthorizationData &
  Required<Pick<DataAuthorizationData, 'id'>>

// Read path: Dataset / JSON-LD → DataAuthorizationData
export async function fromDataset(dataset: DatasetCore, iri: string): Promise<DataAuthorizationData>
export async function fromJsonLd(doc: unknown, iri: string): Promise<DataAuthorizationData>
function compactNodeToDataAuthorizationData(node: any): DataAuthorizationData

// Write path: DataAuthorizationData → Dataset / JSON-LD
export async function toDataset(data: FinalDataAuthorizationData): Promise<Store>
export function toJsonLd(data: FinalDataAuthorizationData): Record<string, unknown>

// Behavior functions (replacing class methods, see Part 2)
export async function inheritingAuthorizations(
  data: DataAuthorizationData,
  factory: AuthorizationAgentFactory
): Promise<DataAuthorizationData[]>

export async function generateDataGrants(
  data: DataAuthorizationData,
  registrySet: CRUDRegistrySet,
  grantee: string
): Promise<SourceAndDelegatedGrants> // { source: FinalGrantData[]; delegated: GrantData[] }

export async function generateGrantsForAuthorization(
  dataAuthorizations: DataAuthorizationData[],
  registrySet: CRUDRegistrySet,
  grantee: string
): Promise<GeneratedGrants>
```

Notes:
- `generateDataGrants(data, registrySet, grantee)` is the old `ReadableDataAuthorization.generateDataGrants` (role handling via `AllFromRole`, source vs. delegated logic) as a standalone function.
- `generateGrantsForAuthorization(dataAuthorizations, registrySet, grantee)` is the old `ReadableAccessAuthorization.generateDataGrants` (filters out `Inherited`-scope authorizations, aggregates `sourceGrants`/`delegatedGrants`, honors the `granted` check by returning empty when the list is empty).
- `GeneratedGrants` type moves from `readable/access-authorization.ts` into `grant.ts` and is re-exported from `data-authorization.ts` / `index.ts`.

---

## Part 2: Detailed Changes

### 1. `packages/data-model/src/crud/authorization-registry.ts` — CRUDAuthorizationRegistry ✅

**Rewritten to link `hasDataAuthorization` directly:**

- `accessAuthorizations()` → renamed `dataAuthorizations(): AsyncIterable<DataAuthorizationData>` — iterates `getDataAuthorizationIris()` and yields `factory.readable.dataAuthorization(iri)`.
- `findAuthorization(agentIri): Promise<ReadableAccessAuthorization | undefined>` → replaced by `findDataAuthorizations(grantee): Promise<DataAuthorizationData[]>` — fetches all data authorizations and filters by `grantee`.
- `add(accessAuthorization)` → replaced by functional helpers (see below). The "replace prior authorization for the same grantee" behavior moves to the recording logic in `authorization-agent/src/authorization.ts`.
- `remove(accessAuthorizationIri)` → replaced by functional helpers.
- `findAuthorizationsDelegatingFromOwner(dataOwner, roleId)` — iterate `getDataAuthorizations()` instead of access authorizations; the grantee exclusion check (`accessAuthorization.grantee !== dataOwner`) becomes `dataAuthorization.grantee !== dataOwner`.

**Added as standalone exported functions (mirroring `crud/agent-registration.ts`):**

```ts
export function getDataAuthorizationIris(registry: CRUDAuthorizationRegistry): string[]
export function getGranted(registry: CRUDAuthorizationRegistry): boolean // iris.length > 0
export async function getDataAuthorizations(registry: CRUDAuthorizationRegistry): Promise<DataAuthorizationData[]>
export async function addDataAuthorization(registry: CRUDAuthorizationRegistry, iri: string): Promise<void>
export async function removeDataAuthorization(registry: CRUDAuthorizationRegistry, iri: string): Promise<void>
export async function removeAllDataAuthorizations(registry: CRUDAuthorizationRegistry): Promise<void>
```

### 2. `packages/data-model/src/readable/access-authorization.ts` — ReadableAccessAuthorization ✅

**Removed entirely.** File deleted. `generateDataGrants` logic lives on as `generateGrantsForAuthorization` in `data-authorization.ts`.

### 3. `packages/data-model/src/immutable/access-authorization.ts` — ImmutableAccessAuthorization ✅

**Removed entirely.** File deleted, along with `AccessAuthorizationData` type, `grantedAt`/`granted`/`grantedWith` writing, and `store()`.

### 4. `packages/data-model/src/readable/data-authorization.ts` and `immutable/data-authorization.ts` ✅

**Removed entirely.** Replaced by the POJO module `data-authorization.ts` (+ `data-authorization-context.ts`) from Part 1. The old `DataAuthorizationData`/`ExpandedDataAuthorizationData` immutable types are superseded by the POJO `DataAuthorizationData` (grantee + grantedBy both present).

### 5. `packages/data-model/src/authorization-agent-factory.ts` — AuthorizationAgentFactory ✅

- `AuthorizationAgentReadableFactory`: removed `accessAuthorization(iri)`; `dataAuthorization(iri)` now returns `Promise<DataAuthorizationData>` — implementation fetches `application/ld+json` and calls `fromJsonLd` (mirror of `dataGrant` in `base-factory.ts`).
- `ImmutableFactory`: removed `accessAuthorization` and `dataAuthorization`. (`immutable.dataGrant` passthrough stays for now; `dataAuthorization` writes happen via `toDataset` + PUT in the recording logic.)

### 6. `packages/data-model/src/index.ts` + `readable/index.ts` + `immutable/index.ts` + `crud/index.ts` ✅

- Removed exports of `ReadableAccessAuthorization`, `ImmutableAccessAuthorization`, `GeneratedGrants` (moved), `AccessAuthorizationData`.
- Exported `DataAuthorizationData`, `FinalDataAuthorizationData`, `fromDataset`/`fromJsonLd`/`toDataset`/`toJsonLd` from `data-authorization.ts` (naming mirrors the `Grant` namespace export for `grant.ts`), `dataAuthorizationContext`, and `jsonld-utils` helpers.
- Kept `CRUDAuthorizationRegistry` and the new functional helpers exported.

### 7. `packages/authorization-agent/src/authorization.ts` — generateAuthorization ✅

**Reworked to create/link DataAuthorizations directly:**

- `generateAuthorization(authorization, grantedBy, authorizationRegistry, factory, extendIfExists)`:
  - `agentId` parameter removed — nothing writes `grantedWith` anymore.
  - Returns `Promise<FinalDataAuthorizationData[]>` (the stored data authorizations) instead of `ReadableAccessAuthorization`.
  - `generateDataAuthorizations(...)` builds `FinalDataAuthorizationData` POJOs (children via `hasInheritingAuthorization`), assigns IRIs with `authorizationRegistry.iriForContained()`, stores each via `toDataset` + PUT.
  - Denied authorizations: clear the grantee's existing data authorizations (`findDataAuthorizations` → `removeDataAuthorization` for each).
  - `extendIfExists` merge logic moved from access-authorization-level to registry-level: `findDataAuthorizations(registry, grantee)` replaces `findAuthorization(grantee)`; reused IRIs + newly created IRIs are linked via a `replaceDataAuthorizationsForGrantee(registry, grantee, iris)` helper (find existing → removeAll → add each).
- `AccessAuthorizationStructure` (GrantedAuthorization | DeniedAuthorization) stays in this file; `granted` now maps to "grantee has data authorizations" rather than a stored boolean.
- `NestedDataAuthorizationData` type is defined here and used by `formatAuthorization`.

### 8. `packages/authorization-agent/src/authorization-agent.ts` — AuthorizationAgent ✅

- `recordAccessAuthorization(authorization, extendIfExists = false)` → returns `Promise<FinalDataAuthorizationData[]>`.
- `generateDataGrants(dataAuthorizationIris: string[], grantee)` → fetch each via `factory.readable.dataAuthorization`, call `generateGrantsForAuthorization(dataAuthorizations, registrySet, grantee)`.
- `findAuthorizationsForAgent(peerId)` → `Promise<DataAuthorizationData[]>` — iterate `registrySet.hasAuthorizationRegistry.dataAuthorizations()`, filter by `grantee === peerId` or role membership.
- `findAgentsWithAccess(dataInstanceIri)` — iterate registry data authorizations directly (drop the access-authorization loop).
- `formatAgentWithAccess(dataAuthorization: DataAuthorizationData)` — type change only.
- `shareDataInstance` returns the **flattened** `FinalDataAuthorizationData[]` (one entry per stored data authorization; `recordAccessAuthorization` now returns an array per agent). **Decision (Q3):** the caller (`ShareResource`) groups the flattened array by `grantee` to build the workflow payloads.
- `formatAuthorization` — include `grantedBy: this.webId` in the produced `NestedDataAuthorizationData` (required in the POJO type).
- Removed `ReadableAccessAuthorization` import; uses `DataAuthorizationData`/`FinalDataAuthorizationData`.

### 9. `packages/components/src/services/Authorization.ts` ✅

- `recordAuthorization`: `recorded` is now `FinalDataAuthorizationData[]`; the API response is an **array of recorded data authorizations** mapped to the new `RecordedDataAuthorization` api-messages schema (see Design Decisions #8). Denied authorizations produce an empty array.
- `buildDataAuthorizations(authorization, accessNeedGroup, grantedBy)` — takes the session webId and includes `grantedBy` in each produced `DataAuthorizationData` (required in the POJO type).
- Workflow call becomes:
  ```ts
  await temporal.client.workflow.execute(createGrantsForAuthorization, {
    taskQueue: 'create-grants',
    args: [{
      webId: saiSession.webId,
      authorizationGrantee: authorization.grantee,
      dataAuthorizationIris: recorded.map((da) => da.id),
    }],
    workflowId: crypto.randomUUID(),
  })
  ```

### 9b. `packages/components/src/services/ShareResource.ts` ✅

- `shareDataInstance` now returns the flattened `FinalDataAuthorizationData[]`.
- Group the recorded data authorizations by `grantee` and start one `createGrantsForAuthorization` workflow per grantee:
  ```ts
  const grouped = new Map<string, string[]>()
  for (const da of recorded) {
    const iris = grouped.get(da.grantee) ?? []
    iris.push(da.id)
    grouped.set(da.grantee, iris)
  }
  // per [grantee, dataAuthorizationIris] entry:
  //   temporal.client.workflow.start(createGrantsForAuthorization, {
  //     args: [{ webId: saiSession.webId, authorizationGrantee: grantee, dataAuthorizationIris }]
  //   })
  ```

### 10. `packages/components/src/temporal/activities/grants.ts` ✅

- `getGrantees(payload: { webId: string; grantee: string })` — grantee comes in the payload (no more fetching the access authorization); role expansion logic unchanged.
- `generateGrants(payload: { webId: string; grantee: string; dataAuthorizationIris: string[] })` → `session.generateDataGrants(payload.dataAuthorizationIris, payload.grantee)`.
- `getAuthorizations(payload)` — `findAuthorizationsForAgent` now returns `DataAuthorizationData[]`; map `(da) => da.id`.
- `deleteAuthorizationsUsingRole({ webId, roleId })` — iterate `getDataAuthorizations(session.registrySet.hasAuthorizationRegistry)`; delete matching data authorization resources via DELETE, unlink via `removeDataAuthorization`.
- `findAffectedAuthorizations` → returns `{ webId, grantee, dataAuthorizationIris }[]` (group the matching data authorizations by grantee) instead of `{ webId, authorizationId }[]`.
- Workflow payload interfaces (see also §11):
  ```ts
  export interface CreateGrantsInput {
    webId: string
    authorizationGrantee: string   // the authorization's grantee — may be a role
    dataAuthorizationIris: string[]
  }

  export interface CreateGrantsForAgentInput {
    webId: string
    grantee: string               // always an agent — the expanded role member
    dataAuthorizationIris: string[]
  }
  ```

### 11. `packages/components/src/temporal/workflows/grants.ts` ✅

- `CreateGrantsInput` → `{ webId: string; authorizationGrantee: string; dataAuthorizationIris: string[] }`.
- **Naming decision (see Design Decisions #11):** the entry payload field is `authorizationGrantee`, NOT `grantee` — a role may only ever be an *authorization* grantee, never a *grant* grantee. `createGrantsForAgent` receives a separate `CreateGrantsForAgentInput` (not `extends CreateGrantsInput`) whose `grantee` is the expanded member agent.
- `createGrantsForAuthorization(payload)` → `getGrantees({ webId, grantee: payload.authorizationGrantee })` → `createGrantsForAgent` for each member with the child payload built explicitly (`{ webId, grantee, dataAuthorizationIris }`) — no spread of the entry payload, so the role can never clobber the member:
  ```ts
  export async function createGrantsForAuthorization(
    payload: activities.CreateGrantsInput
  ): Promise<void> {
    const grantees = await getGrantees({
      webId: payload.webId,
      grantee: payload.authorizationGrantee,
    })
    await Promise.all(
      grantees.map((grantee) =>
        executeChild(createGrantsForAgent, {
          args: [
            {
              webId: payload.webId,
              grantee,
              dataAuthorizationIris: payload.dataAuthorizationIris,
            },
          ],
        })
      )
    )
  }
  ```
- `createGrantsForAgent` — unchanged grant generation/storage; input carries `dataAuthorizationIris` and the agent `grantee`.
- `updateGrantsForOneAgent` / `updateGrantsForAuthorization` — pass `dataAuthorizationIris` from `getAuthorizations` / `findAffectedAuthorizations` instead of `authorizationId`; `updateGrantsForAuthorization` forwards `authorizationGrantee: payload.grantee`.

### 12. `packages/api-messages/src/effect.ts` ✅

**Decision (Q1):** the API response changes to an **array of data authorizations**.

- Added `RecordedDataAuthorization` schema (the stored data authorization shape: `id`, `grantee`, `grantedBy`, `registeredShapeTree`, `scopeOfAuthorization`, optional `dataOwner`/`hasDataRegistration`/`satisfiesAccessNeed`/`inheritsFromAuthorization`, `accessMode`, optional `creatorAccessMode`/`hasDataInstance`/`hasInheritingAuthorization`).
- `AccessAuthorization = S.Array(RecordedDataAuthorization)`. Denied authorizations return `[]` (no `id` needed — see Design Decision #8).

### 13. Test Files ✅ (integration done at the time; unit tests completed by the later refactors)

**Done — integration tests (`test/`):**
- `test/roles.test.ts` — updated to the new response shape (`body` is an array of recorded data authorizations, `body[0].grantee`/`grantedBy`/`id` assertions).
- `test/authorization.test.ts` — "denied" test rewritten: response is `[]` for a denied authorization (`expect(Array.isArray(value)).toBe(true)`, `expect(value.length).toBe(0)`); registry check via `findDataAuthorizations(grantee)` instead of `findAuthorization`; no `id`/`callbackEndpoint` assertions.
- `packages/css-storage-fixture/test/registry.trig` — fixture rewritten from `hasAccessAuthorization` to direct `hasDataAuthorization` links.

**Done — unit tests (completed as part of `refactor-data-model.md` / `refactor-data-model-followup.md` / `improve-jsonld-use.md`; the JSON-LD framing suites live in `packages/data-model/test/framing/`):**
- `packages/data-model/test/readable/access-authorization.test.ts` — **deleted**.
- `packages/data-model/test/immutable/access-authorization.test.ts` — **deleted**.
- `packages/data-model/test/immutable/data-authorization.test.ts` — **rewritten** to `framing/data-authorization.test.ts` + the `pojo/*` round-trip suites.
- `packages/data-model/test/readable/data-authorization.test.ts` — **rewritten** to the `fromJsonLd`/`frameDoc` read path (`readable/*`, `framing/*`).
- `packages/data-model/test/crud/access-consent-registry.test.ts` — **updated** to `ldp:contains`-based `getDataAuthorizationIris`/`findDataAuthorizations` (see `simplify-authorization-containment.md`).
- `packages/data-model/test/authorization-agent-factory.test.ts` — **updated** (`dataAuthorization` returns the POJO).
- `packages/authorization-agent/test/authorization-agent.test.ts` — still `describe.skip`-gated; separately tracked in `simplify-authorization-containment.md` §8.

**New (optional):**
- `packages/data-model/test/jsonld-utils.test.ts` — framing/RDF round-trip for a generic context — **not created as a dedicated file**; the `framing/*` suites cover the behavior, and the helpers moved to `@janeirodigital/interop-utils` with dedicated `packages/utils/test/jsonld.test.ts` (see `cleanup-fetch-utils.md`).

---

## Key Functions to Create (Functional Approach)

Following the functional approach from the grants migration (standalone exported functions taking the instance as parameter):

### In `packages/data-model/src/jsonld-utils.ts` ✅

```ts
export function buildFrame(context: JsonLdContext, iri: string): Record<string, unknown>
export async function frameDataset(dataset: DatasetCore, context: JsonLdContext, iri: string): Promise<Record<string, unknown>>
export async function frameDoc(doc: unknown, context: JsonLdContext, iri: string): Promise<Record<string, unknown>>
export async function toStore(doc: Record<string, unknown>, base?: string): Promise<Store>
export function withContext(context: JsonLdContext, node: Record<string, unknown>): Record<string, unknown>
```

### In `packages/data-model/src/data-authorization.ts` ✅

```ts
export type DataAuthorizationData   // plain JSON, id optional
export type FinalDataAuthorizationData
export async function fromDataset(dataset, iri): Promise<DataAuthorizationData>
export async function fromJsonLd(doc, iri): Promise<DataAuthorizationData>
export async function toDataset(data: FinalDataAuthorizationData): Promise<Store>
export function toJsonLd(data: FinalDataAuthorizationData): Record<string, unknown>
export async function inheritingAuthorizations(data, factory): Promise<DataAuthorizationData[]>
export async function generateDataGrants(data, registrySet, grantee): Promise<SourceAndDelegatedGrants>
export async function generateGrantsForAuthorization(dataAuthorizations, registrySet, grantee): Promise<GeneratedGrants>
```

### In `packages/data-model/src/crud/authorization-registry.ts` ✅

```ts
export function getDataAuthorizationIris(registry: CRUDAuthorizationRegistry): string[]
export function getGranted(registry: CRUDAuthorizationRegistry): boolean
export async function getDataAuthorizations(registry: CRUDAuthorizationRegistry): Promise<DataAuthorizationData[]>
export async function addDataAuthorization(registry: CRUDAuthorizationRegistry, iri: string): Promise<void>
export async function removeDataAuthorization(registry: CRUDAuthorizationRegistry, iri: string): Promise<void>
export async function removeAllDataAuthorizations(registry: CRUDAuthorizationRegistry): Promise<void>
```

### In `packages/authorization-agent/src/authorization.ts` ✅

```ts
export async function generateAuthorization(
  authorization: AccessAuthorizationStructure,
  grantedBy: string,
  authorizationRegistry: CRUDAuthorizationRegistry,
  factory: AuthorizationAgentFactory,
  extendIfExists: boolean
): Promise<FinalDataAuthorizationData[]>

export async function replaceDataAuthorizationsForGrantee(
  registry: CRUDAuthorizationRegistry,
  grantee: string,
  dataAuthorizationIris: string[]
): Promise<void>

// additionally implemented (used by generateAuthorization)
export async function generateDataAuthorizations(
  authorization: GrantedAuthorization,
  grantedBy: string,
  authorizationRegistry: CRUDAuthorizationRegistry,
  factory: AuthorizationAgentFactory
): Promise<FinalDataAuthorizationData[]>
```

---

## Migration Order

### ✅ Done (commit `c6527fb3 authorizations as pojos`)

1. **data-model — JSON-LD extraction** — `jsonld-utils.ts` added; `grant.ts` refactored (no public API change).
2. **data-model — DataAuthorization POJO** — `data-authorization-context.ts` + `data-authorization.ts` (types, from/to, behavior functions); `readable/data-authorization.ts` and `immutable/data-authorization.ts` deleted; `authorization-agent-factory.ts` updated; index exports updated.
3. **data-model — remove AccessAuthorization** — `readable/access-authorization.ts` and `immutable/access-authorization.ts` deleted; `crud/authorization-registry.ts` rewritten (direct `hasDataAuthorization` + functional helpers); `GeneratedGrants` moved to `grant.ts`.
4. **authorization-agent package** — `authorization.ts` reworked (`generateAuthorization`, `generateDataAuthorizations`, `replaceDataAuthorizationsForGrantee`); `authorization-agent.ts` updated (`recordAccessAuthorization`, `generateDataGrants`, `findAuthorizationsForAgent`, `findAgentsWithAccess`, `shareDataInstance`).
5. **components package** — `services/Authorization.ts` and `services/ShareResource.ts` updated (array response, per-grantee workflows with `authorizationGrantee`); `temporal/activities/grants.ts` and `temporal/workflows/grants.ts` updated (payload carries `dataAuthorizationIris` + `authorizationGrantee`; child payload separated with agent `grantee`).
6. **api-messages** — `effect.ts`: `RecordedDataAuthorization` schema; `AccessAuthorization = S.Array(RecordedDataAuthorization)`.
7. **integration tests** — `test/roles.test.ts`, `test/authorization.test.ts`, `packages/css-storage-fixture/test/registry.trig` updated.

### ✅ Done (unit tests — completed by the subsequent data-model refactors)

8. **unit tests** — delete/rewrite `packages/data-model` and `packages/authorization-agent` tests per §13, then run full build — **landed** as part of `refactor-data-model.md`/`refactor-data-model-followup.md`/`improve-jsonld-use.md`; only `authorization-agent.test.ts` remains `describe.skip`-gated (tracked in `simplify-authorization-containment.md` §8).

---

## Key Design Decisions (Confirmed)

1. **AccessAuthorization is completely removed** — both `ImmutableAccessAuthorization` and `ReadableAccessAuthorization` classes, `AccessAuthorizationData`, and all related exports. No more AccessAuthorization resources created or read.

2. **DataAuthorizations become POJOs** — `DataAuthorizationData` + `FinalDataAuthorizationData`, read via `fromDataset`/`fromJsonLd` and written via `toDataset`/`toJsonLd`, exactly like the grants migration. This requires the JSON-LD extraction in Part 0.

3. **Lazy async data authorization access** — no caching. Every call to `getDataAuthorizations()` fetches the resources fresh.

4. **Granted is computed** — `getGranted(registry)` returns `getDataAuthorizationIris().length > 0`. Per-grantee: `findDataAuthorizations(registry, grantee).length > 0`.

5. **`grantedWith` (agentId) is not migrated** — the `agentId` parameter of `generateAuthorization` is dropped. DataAuthorizations already carry `grantedBy`. Accepted trade-off.

6. **`hasAccessNeedGroup` on AccessAuthorization is not migrated** — same accepted trade-off as the grants migration. The access need group remains available on ApplicationRegistration / SocialAgentRegistration for UI flows.

7. **`extendIfExists` moves to registry level** — reuse/merge of existing data authorizations for a grantee happens against `findDataAuthorizations(registry, grantee)` instead of a single AccessAuthorization.

8. **API response** — **Decision (Q1):** the `AccessAuthorization` response becomes an **array of recorded data authorizations** (`S.Array(RecordedDataAuthorization)`). Denied authorizations return `[]`. The previous response `id` was only used by the UI as a truthy trigger to redirect after the action completes, so no `id` is needed — an empty array is still truthy and the UI keeps working. (Verified: `ui/authorization/src/components/AuthorizeApp.vue` only checks truthiness; `callbackEndpoint` is not consumed from this response.)

9. **Registry no longer enforces one wrapper per grantee** — the registry simply links all current data authorizations; the recording logic handles replacing a grantee's prior links.

10. **`shareDataInstance` return shape** — **Decision (Q3):** returns the flattened `FinalDataAuthorizationData[]`; `ShareResource` groups by `grantee` to build the `createGrantsForAuthorization` workflow payloads.

11. **`authorizationGrantee` vs `grantee` naming (added during implementation)** — a role may only ever be an *authorization* grantee, never a *grant* grantee; grants and ACRs must target actual member agents. To make this explicit at the type level:
    - The workflow entry payload `CreateGrantsInput` uses `authorizationGrantee` (may be a role; consumed only by `getGrantees` for role → members expansion).
    - `createGrantsForAgent` gets its own `CreateGrantsForAgentInput` (not `extends CreateGrantsInput`) whose `grantee` is always the expanded member agent.
    - This also fixes the pre-existing `{ grantee, ...payload }` spread bug: previously the entry payload's `grantee` (the role) silently overwrote the expanded member, leaking a role into `GrantData.grantee`, `createAcr`, and `clearDataGrantsOnRegistration`/`setDataGrantsOnRegistration` (which throw for roles).
