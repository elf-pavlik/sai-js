# Plan: Simplify AuthorizationRegistry containment (`hasDataAuthorization` → `ldp:contains`)

> **Status:** ✅ implementation complete — data-model, authorization-agent and components
> sources, the CSS fixture and the test-utils mock updated; data-model unit tests pass.
> ⏳ `authorization-agent.test.ts` deferred (full rewrite required, see §8); ⏳ integration
> tests not yet run (see §9).

## Motivation

`AuthorizationRegistry` currently tracks its data authorizations with
`interop:hasDataAuthorization`, a link that the **client** must manage:

- created/removed via SPARQL PATCH to the registry's *description resource*
  (`CRUDContainer.addStatement` / `removeStatement` → `applyPatch` → `discoverDescriptionResource()`),
- stored in the **meta/description graph** of the container
  (`GRAPH <meta:https://registry/acme/authorization/>` in `registry.trig`).

`GrantRegistry` (and `RoleRegistry`) instead use `ldp:contains`, which is
**automatically managed by the server**: the SPARQL backend inserts
`parent ldp:contains child` on PUT (`SparqlDataAccessor.sparqlInsert`) and
removes it on DELETE (`sparqlDelete`); the file backend derives it from the
filesystem. `DataAccessorBasedStore.getRepresentation` includes the
`ldp:contains` quads in container GET responses, so a plain
`getObjectsArray(LDP.contains)` read works — the pattern `CRUDRoleRegistry.roles`
already uses.

Goal: make `AuthorizationRegistry` use `ldp:contains` the same way, and drop the
client-managed `interop:hasDataAuthorization` entirely.

## Current Architecture

```
AuthorizationRegistry (CRUDAuthorizationRegistry)
  └─ interop:hasDataAuthorization (meta graph, client-managed)
       └─ DataAuthorization[] (resources in the container, linked/unlinked by client)
```

- Read: `getDataAuthorizationIris(registry)` = `registry.getObjectsArray(INTEROP.hasDataAuthorization)`.
- Write (client): `addDataAuthorization` / `removeDataAuthorization` / `removeAllDataAuthorizations`
  — SPARQL PATCH to the description resource.
- Consequence: on deny/revoke/replace the client only *unlinks*; the data
  authorization **resources stay on the server as orphans** (invisible, never cleaned up).

## Target Architecture

```
AuthorizationRegistry (CRUDAuthorizationRegistry)
  └─ ldp:contains (container's own graph, server-managed)
       └─ DataAuthorization[] (resources in the container)
```

- Read: `getDataAuthorizationIris(registry)` = `registry.getObjectsArray(LDP.contains)`
  (exactly like `CRUDRoleRegistry.roles`).
- Write: nothing to manage — PUT adds the resource to the container (containment
  appears), DELETE removes it (containment disappears).
- Consequence (decided): deny/revoke/replace now **physically DELETE** the data
  authorization resources instead of leaving orphans.

## Scope of Changes

| Package | Files | Status |
|---------|-------|--------|
| `packages/data-model` | `src/crud/authorization-registry.ts`, `src/crud/index.ts` | ✅ |
| `packages/authorization-agent` | `src/authorization.ts` | ✅ |
| `packages/components` | `src/temporal/activities/grants.ts` | ✅ |
| `packages/css-storage-fixture` | `test/registry.trig` | ✅ |
| `packages/test-utils` | `src/data.json` (mock snippet) | ✅ |
| Tests | `packages/data-model/test/crud/access-consent-registry.test.ts` | ✅ |
| Tests | `packages/authorization-agent/test/authorization-agent.test.ts` | ⏳ deferred (full rewrite, see §8) |
| Tests | `test/authorization.test.ts`, `test/roles.test.ts` (integration) | ⏳ not run (see §9) |

---

## Detailed Changes

### 1. `packages/data-model/src/crud/authorization-registry.ts` ✅

**Read path switch:** `getDataAuthorizationIris` reads `LDP.contains` instead of
`INTEROP.hasDataAuthorization`:

```ts
import { INTEROP, LDP, RDF } from '@janeirodigital/interop-utils'

export function getDataAuthorizationIris(registry: CRUDAuthorizationRegistry): string[] {
  return registry.getObjectsArray(LDP.contains).map((node) => node.value)
}
```

Everything downstream is unchanged because it already goes through
`getDataAuthorizationIris` / `getDataAuthorizations` / `dataAuthorizations()`:
- `getGranted(registry)` — still `iris.length > 0`
- `dataAuthorizations()`, `findDataAuthorizations`, `findAuthorizationsDelegatingFromOwner`
- `getDataAuthorizations`

**Remove the client-managed write helpers** (they are meaningless once the
server owns containment):
- `addDataAuthorization`
- `removeDataAuthorization`
- `removeAllDataAuthorizations`

**Staleness:** the registry's in-memory dataset is populated by `fetchData()`
(container GET, which includes `ldp:contains`). Since the client no longer
updates the dataset locally, every mutation (PUT/DELETE of a data authorization)
must be followed by `await registry.fetchData()` — mirroring
`CRUDRoleRegistry.createRole` / `deleteRole`.

Note: `CRUDAuthorizationRegistry` already inherits `containedIncludes(id)` from
`CRUDContainer` (reads `LDP.contains`) — usable for membership checks without a
fetch.

### 2. `packages/data-model/src/crud/index.ts` ✅

Remove the explicit re-exports of `addDataAuthorization`, `removeDataAuthorization`,
`removeAllDataAuthorizations` (keep `CRUDAuthorizationRegistry`,
`getDataAuthorizationIris`, `getDataAuthorizations`).

### 3. `packages/authorization-agent/src/authorization.ts` ✅

`generateAuthorization` — write path rework (server-managed containment):

- **Granted path** (replaces `replaceDataAuthorizationsForGrantee`):
  1. `existingDataAuthorizations = await authorizationRegistry.findDataAuthorizations(grantee)`
     (reads current `ldp:contains`)
  2. compute `dataAuthorizationsToReuse` (existing extend/merge logic unchanged)
  3. PUT new `FinalDataAuthorizationData` resources (unchanged)
  4. DELETE each existing data authorization resource whose IRI is **not** in
     `dataAuthorizationsToReuse` (parent + its `hasInheritingAuthorization`
     children — all share the grantee):
     ```ts
     const response = await factory.fetch(iri, { method: 'DELETE' })
     ```
     (reused ones stay — containment keeps them linked)
  5. `await authorizationRegistry.fetchData()`

- **Denied path**: DELETE all of the grantee's existing data authorization
  resources (implemented as the same helper with `irisToKeep = []`), then
  `await authorizationRegistry.fetchData()`.

- Remove imports of `addDataAuthorization` / `removeDataAuthorization`; rework
  `replaceDataAuthorizationsForGrantee` into the deletion-based replace below.

Merge/extend semantics are preserved: the merged parent is a **new** resource
that absorbs the old instances; the old parent + its children are deleted, so no
dangling `inheritsFromAuthorization` references remain (the new parent's
`hasInheritingAuthorization` points at its own new children).

**Implementation notes (deviations from the draft, agreed during review):**

- The helper does **not** re-read the registry (`findDataAuthorizations`) at call
  time. `generateAuthorization` already fetches the snapshot once at the top and
  uses the *same* array for both the merge/reuse computation and the deletion
  set, so it is passed in as a parameter. This avoids relying on the registry's
  in-memory dataset being in a non-mutated (pre-`fetchData`) state — a fragile
  invariant: if a `fetchData()` ever ran between the PUTs and the helper call,
  the freshly stored resources would be in the dataset, and since their IRIs are
  not in the reuse set, they would be deleted.
- The deletion set is computed with `Set` operations: `keep` is a `Set` of
  `irisToKeep` (O(1) membership) expanded with the `hasInheritingAuthorization`
  children of *kept* parents (children are never in `irisToKeep`, but a kept
  parent still references them), and `irisToDelete` is the `Set.difference` of
  all existing parent+child IRIs minus `keep` (auto-dedup).
- Deletes run in a sequential `for...of` loop with the repo-convention comment
  `// Change back to Promise.all after the CSS bug is fixed.` (same pattern as
  `packages/components/src/temporal/workflows/grants.ts`).

### 4. `packages/components/src/temporal/activities/grants.ts` ✅

`deleteAuthorizationsUsingRole` — currently deletes the resource **and** calls
`removeDataAuthorization`. With server-managed containment the DELETE alone
removes the registry link; drop the `removeDataAuthorization` call and its import.
(`getDataAuthorizations` read stays.)

### 5. `packages/css-storage-fixture/test/registry.trig` — graph placement (critical) ✅

The trig is a quadstore snapshot served by CSS's SPARQL backend, where:

- the container's **own graph** (`GRAPH <https://registry/acme/authorization/>`)
  holds server-managed `ldp:contains` (this is what `getChildren` / container
  GET serve),
- the **meta graph** (`GRAPH <meta:https://registry/acme/authorization/>`) holds
  description-resource content (types, timestamps) — what the client writes via
  PATCH to the description resource.

So `ldp:contains` must move into the container's **own graph**, while the type
stays in the **meta graph** — exactly the existing `GrantRegistry` layout
(`GRAPH <https://registry/acme/grant/>` has `ldp:contains`; `GRAPH
<meta:https://registry/acme/grant/>` has `a interop:GrantRegistry, ldp:Resource`).

For each of **acme, alice, bob, yoyo**:

```diff
 GRAPH <meta:https://registry/acme/authorization/> {
   <https://registry/acme/authorization/>
-    a interop:AuthorizationRegistry, ldp:Resource;
-    interop:hasDataAuthorization
-      <https://registry/acme/authorization/k9m4vp>,
-      <https://registry/acme/authorization/r5j8tw>,
-      <https://registry/acme/authorization/p3j7mq>,
-      <https://registry/acme/authorization/m9k4wr>.
+    a interop:AuthorizationRegistry, ldp:Resource .
+}
+
+GRAPH <https://registry/acme/authorization/> {
+  <https://registry/acme/authorization/>
+    ldp:contains
+      <https://registry/acme/authorization/k9m4vp>,
+      <https://registry/acme/authorization/r5j8tw>,
+      <https://registry/acme/authorization/p3j7mq>,
+      <https://registry/acme/authorization/m9k4wr>.
 }
```

Contained IRIs per registry (from the current file):

| registry | data authorization IRIs |
|----------|--------------------------|
| acme (line 42) | `k9m4vp`, `r5j8tw`, `p3j7mq`, `m9k4wr` |
| alice (line 519) | `w329t6`, `p7n4qw`, `t5m8kr`, `g08qqa` |
| bob (line 984) | `t1u13z` |
| yoyo (line 1371) | `k2m5qp`, `t8p3wr` |

**kim and dan**: authorization registries are empty (meta graph has the type
only, no `hasDataAuthorization`, no own-graph block) — no changes required.
(Optionally add empty `GRAPH <https://registry/<x>/authorization/> {}` blocks for
consistency with the empty grant-registry blocks, but they are not needed.)

No changes to the data authorization **resource** graphs or their meta graphs
(`GRAPH <https://registry/acme/authorization/k9m4vp>` / `GRAPH
<meta:https://registry/acme/authorization/k9m4vp>`).

### 6. `packages/test-utils/src/data.json` ✅

The mock snippet for the authorization registry
(`https://auth.alice.example/96feb105-063e-4996-ab74-5e504c6ceae5`) serves the
container GET body, so it must contain `ldp:contains` instead of
`interop:hasDataAuthorization`:

```diff
-PREFIX interop: <http://www.w3.org/ns/solid/interop#>
+PREFIX interop: <http://www.w3.org/ns/solid/interop#>
+PREFIX ldp: <http://www.w3.org/ns/ldp#>
 PREFIX alice-auth: <https://auth.alice.example/>

 alice-auth:96feb105-063e-4996-ab74-5e504c6ceae5
   a interop:AuthorizationRegistry ;
-  interop:hasDataAuthorization
+  ldp:contains
     alice-auth:e2765d6c-848a-4fc0-9092-556903730263 ,
     alice-auth:6a9feb57-252b-43b2-8470-5a938888b2fa ,
     alice-auth:329eb90a-feb9-4c95-a427-2ef23989abe9 ,
     alice-auth:fe442ef3-5200-4b06-b4bc-fc0b495603a9 ,
     alice-auth:a691ee69-97d8-45c0-bb03-8e887b2db806 ,
     alice-auth:ecdf7b5e-5123-4a93-87bc-86ef6de389ff .
```

### 7. `packages/data-model/test/crud/access-consent-registry.test.ts` ✅

- `getDataAuthorizationIris` test: still valid (now reads `ldp:contains` from the
  mock snippet); wording updated to "contained" data authorizations.
- `add` / `remove` describe blocks: **removed** (helpers deleted). Replaced with a
  `containedIncludes` test asserting the registry exposes contained authorizations
  via `LDP.contains`.
- The proposed "DELETE of a contained resource reflected after `fetchData()`" test
  was **not added**: the test-utils mock fetch only short-circuits `PUT`/`PATCH`;
  a `DELETE` falls through to serving the static `data.json`, so deletion cannot
  be observed (mock-dependent, and the mock does not support it).
- `findDataAuthorizations` / `findAuthorizationsDelegatingFromOwner`: unchanged.
- Result: 36 test files, 202 tests passing.

### 8. `packages/authorization-agent/test/authorization-agent.test.ts` ⏳ deferred

Pre-existing condition: this file already references removed APIs
(`findAuthorization`, `hasAccessAuthorization`, `ReadableAccessAuthorization`)
and was left unmigrated by the previous plan (`remove-access-authorization-indirection.md`,
§13). Beyond that migration, it needs the `hasDataAuthorization` mock/assertions
(lines ~179–309) updated to the `ldp:contains`-based registry model — i.e. the
mock registry's dataset carries `LDP.contains` quads and `findDataAuthorizations`
reads them; denied/replaced authorizations are **deleted**, so the mocks must
record DELETE calls rather than unlink quads.

**Deferred on purpose:** the whole file is `describe.skip`'d (never runs) and its
migration is entangled with the unfinished previous-plan migration (removed
access-authorization indirection, changed `recordAccessAuthorization` return
shape, changed `generateDataGrants` signature) plus mock-data gaps (extend-test
IRIs `5ae2442a…`/`99c56d7c…` missing from `data.json`; no DELETE support in the
mock fetch). It will be fully rewritten in a separate step.

### 9. Integration tests ⏳ not run

- `test/authorization.test.ts` — `findDataAuthorizations(clientId)` assertions
  still hold (denied authorization deletes resources → containment empty → `[]`).
- `test/roles.test.ts` — assertions on recorded `id`s (`https://registry/bob/authorization/...`)
  unchanged.
- Verify both pass; update only if the delete-on-replace changes observable state.

**Not yet executed** — requires the CSS fixture and a running test environment;
pending the separate test-update step.

---

## Key Functions to Change / Create

### `packages/data-model/src/crud/authorization-registry.ts`

```ts
export function getDataAuthorizationIris(registry: CRUDAuthorizationRegistry): string[]
  // LDP.contains instead of INTEROP.hasDataAuthorization
export function getGranted(registry: CRUDAuthorizationRegistry): boolean          // unchanged
export async function getDataAuthorizations(registry): Promise<DataAuthorizationData[]>  // unchanged
// removed: addDataAuthorization, removeDataAuthorization, removeAllDataAuthorizations
```

### `packages/authorization-agent/src/authorization.ts`

```ts
export async function generateAuthorization(
  authorization, grantedBy, authorizationRegistry, factory, extendIfExists
): Promise<FinalDataAuthorizationData[]>
  // granted: PUT new; DELETE existing (not in reuse set); registry.fetchData()
  // denied : DELETE all existing of the grantee; registry.fetchData()

// reworked (deletion-based replace, snapshot-based + set-based):
export async function replaceDataAuthorizationsForGrantee(
  registry, existingDataAuthorizations, irisToKeep, factory
): Promise<void>
  // DELETE existing grantee authorizations (parent + children) whose id ∉ irisToKeep;
  // deletes run sequentially (see CSS-bug TODO); registry.fetchData() at the end.
  // NOTE: the snapshot is passed in (fetched once in generateAuthorization) rather than
  // re-read from the registry, to avoid depending on non-mutated in-memory state.
```

### `packages/components/src/temporal/activities/grants.ts`

```ts
// deleteAuthorizationsUsingRole: DELETE resource only (drop removeDataAuthorization)
```

---

## Migration Order

1. ✅ **data-model** — `crud/authorization-registry.ts` read path → `LDP.contains`;
   delete write helpers; update `crud/index.ts` exports.
2. ✅ **data-model unit tests** — update mock snippet (`test-utils/data.json`) and
   `access-consent-registry.test.ts` (add/remove blocks removed, `containedIncludes`
   added; DELETE-after-`fetchData` test skipped — mock has no DELETE support).
3. ✅ **authorization-agent** — `authorization.ts` write path
   (delete-on-replace/deny + `fetchData()`); its unit tests deferred (see §8).
4. ✅ **components** — `temporal/activities/grants.ts` (`deleteAuthorizationsUsingRole`).
5. ✅ **fixture** — `css-storage-fixture/test/registry.trig` (move `hasDataAuthorization`
   → `ldp:contains` into the containers' own graphs; verified with an N3 TriG parse).
6. ⏳ **integration tests** — run `test/authorization.test.ts`, `test/roles.test.ts`;
   adjust if needed (not yet run).

---

## Key Design Decisions

1. **`ldp:contains` is server-managed** — the registry only reads it
   (`getObjectsArray(LDP.contains)`), exactly like `CRUDRoleRegistry.roles`.
   No client-side link management; no orphaned authorizations.
2. **Deny/revoke/replace physically DELETES the data authorization resources**
   (confirmed) — there is no separate link to remove. Verified safe: grant
   revocation never fetches unlinked/deleted authorizations (see Observations).
3. **`fetchData()` after every mutation** (confirmed) — mirrors
   `CRUDRoleRegistry.createRole` / `deleteRole`; keeps the in-memory dataset in
   sync with the server-managed containment.
4. **Type stays in the meta graph** — `bootstrap()`/`create()` still write
   `interop:AuthorizationRegistry` to the description resource; only the
   containment moves to the container's own graph, matching the grants layout.
5. **Write helpers removed** — `addDataAuthorization`, `removeDataAuthorization`,
   `removeAllDataAuthorizations` are deleted (no longer expressible operations).
   (`removeAllDataAuthorizations` was dead code — used nowhere.)
6. **`getDataAuthorizationIris` keeps its name** — it now returns the contained
   data authorization IRIs; no rename needed.
7. **Deletion snapshot is passed in, not re-read** — `replaceDataAuthorizationsForGrantee`
   takes `existingDataAuthorizations` (the array already fetched by
   `generateAuthorization` for the merge/reuse computation) so delete decisions
   are consistent with the reuse set and independent of the registry's in-memory
   dataset state (which would otherwise have to be guaranteed non-mutated).
8. **Deletion set computed with `Set` operations** — `keep` (O(1) membership,
   expanded with children of kept parents) and `Set.difference` for
   `irisToDelete`; deletes run sequentially until the CSS bug is fixed
   (`// Change back to Promise.all after the CSS bug is fixed.`).

---

## Observations (pre-existing, out of scope)

- **Grant revocation is driven by registry state, not by the unlinked
  authorization resources.** Deny → workflow gets `dataAuthorizationIris: []` →
  `createGrantsForAgent` → `clearDataGrantsOnRegistration` + empty
  `setDataGrantsOnRegistration`. Role change → `deleteAuthorizationsUsingRole`
  already deletes resources, then `updateGrantsForOneAgent` re-reads the registry
  (`getAuthorizations` → `findAuthorizationsForAgent`) and clears/regenerates.
  `generateDataGrants` fetches authorizations **by IRI**, but only for freshly
  recorded IRIs or IRIs currently in the registry — never deleted ones, so the
  delete-on-revoke approach cannot 404.
- **Extend-flow grant quirk** (unchanged by this plan): `createGrantsForAgent`
  clears **all** of the grantee's data-grant links and re-adds only grants
  generated from the newly recorded authorization IRIs, so grants of *reused*
  (kept) authorizations are dropped. Independent of the containment model.
- **Dev fixture** (`packages/css-storage-fixture/dev/pod/`) still uses the
  pre-migration `hasAccessAuthorization` model (file backend) and is stale; not
  part of this change.
