# Cleanup: drop `RdfFetch`/`fetchWrapper`, keep only `WhatwgFetch`

> **Status:** ✅ done — all phases landed (commit `54697865 cleanup fetch utils`; Phases 2–3 executed together).
>
> **Goal.** Delete `packages/utils/src/fetch.ts` and the `RdfFetch` abstraction entirely. After this plan the codebase has a single fetch type — `WhatwgFetch` — and all RDF parsing happens via explicit JSON-LD helpers (`fetchJsonLd`, `documentValues`, `findNodeIdByType`, `frameDoc`, `toStore`, …), the pattern data-model already uses everywhere.
>
> **Why now.** Survey of every call site shows the wrapper's RDF features are nearly unused:
> - `.dataset()` on responses — exactly **2 production consumers** (see §1), and both can use the `fetchJsonLd` pattern that data-model already applies for the *identical* operations (`data-registry.ts:86-88` `storageIri()` is the exact template for `findResourceOwner`).
> - outgoing `dataset` request option — **zero production callers** (only `utils/test/fetch.test.ts`).
> - everything else calls `fetch.raw` — a plain `WhatwgFetch` — or calls the wrapper as a plain function (only `response.ok` / `headers` / `json()`).
> - `discoverDelegationIssuanceEndpoint` ignores the injected fetch and uses the **global `fetch`** (latent bug — fixed in Phase 1 §1c).
>
> **Phase structure:**
> 0. ✅ **done** — Move generic JSON-LD helpers from data-model → utils (`packages/utils/src/jsonld.ts`, data-model `jsonld-utils.ts` is a re-export shim)
> 1. ✅ **done** — Pinning unit tests written, then converted the two `.dataset()` consumers + the manual `fetch`+`parseJsonld` discovery functions to `fetchJsonLd`/`documentValues`/`findNodeIdByType`; updated all discovery callers
> 2. ✅ **done** — Delete `fetch.ts`, collapse `RdfFetch` → `WhatwgFetch` everywhere, drop `.raw`
> 3. ✅ **done** — Test cleanup — delete `fetch.test.ts`, update the tests that exercised the wrapper (`.dataset()` holdout, `RdfResponse` casts)
> 4. ✅ **done** — Delete `data-model/src/jsonld-utils.ts` (the Phase 0 re-export shim) — `withContext` moved to utils, `linkedIrisJsonLd` moved to `context.ts`, importers point at `@janeirodigital/interop-utils` directly
>
> **Each phase ends green**: after every phase `npm run build` (turbo) + `npm test` (turbo, packages) must pass. Phases are ordered so the tests that pin a behavior change are added *before* the change that would break them. The only caveat is the `test/` integration workspace (dagger-only, §Verification) — its edits are verified by `tsc --noEmit` locally and the dagger suite as final gate.

---

## Current state (surveyed)

`packages/utils/src/fetch.ts` exports:

| Export | Kind | Production consumers |
|---|---|---|
| `fetchWrapper(whatwgFetch)` | function | `application.ts`, `authorization-agent.ts` (constructor), `components/*` (6 sites), `test-utils/fetch-mock.ts` (2 sites), tests |
| `RdfFetch` | type | factory plumbing (`FactoryDependencies`, `BaseFactory`, `ApplicationFactory`, `AuthorizationAgentFactory`), `discovery.ts` (2 fns), tests |
| `RdfResponse` | type | test casts only |
| `RdfRequestInit` (incl. `dataset` option) | type | **none** — the outgoing-`dataset` serialization has zero production callers |
| `WhatwgFetch` | type | ~30 files — **this one stays** (relocated, §4) |

**Direct calls of the wrapper as a function** (`factory.fetch(...)` / `this.fetch(...)` / `session.fetch(...)`):

| Call site | Uses | Needs wrapper? |
|---|---|---|
| `discovery.ts:51` `discoverAuthorizationAgent` | `.dataset()` on WebID profile | yes (converted in Phase 1 §1a) |
| `authorization-agent.ts:190-191` `findResourceOwner` | `.dataset()` on storage description | yes (converted in Phase 1 §1b) |
| `crud/container.ts` (HEAD/PATCH/PUT), `crud/role-registry.ts:69` (DELETE), `authorization.ts:102` (DELETE), `grants.ts:202,288` (DELETE/POST) | only `response.ok` / `headers.get('Link')` / `response.json()` | no — identical with `WhatwgFetch` |

**`fetch.raw` (WhatwgFetch) call sites** — the overwhelming majority: every loader in `base-factory.ts` + `authorization-agent-factory.ts`, all `crud/*` modules, `data-instance.ts` (`HEAD` + `fetchJsonLd`), `shape-tree.ts:121`, `access-need.ts:77`, `access-need-group.ts:62`, `access-description-set.ts:92`, components (`ReciprocalWebhookStore.ts` spreads `...raw`, `services/AgentRegistry.ts:207`, `InvitationHandler.ts:87`, `temporal/activities/grants.ts:129`), and the discovery functions that already take `WhatwgFetch` (`discoverAgentRegistration`, `discoverDescriptionResource`, `discoverStorageDescription`, `discoverAuthorizationRedirectEndpoint`, `discoverWebPushService`, …).

**Key facts:**
- data-model readable/crud tests (~40 files) already exercise the **WhatwgFetch path** (`factory.fetch.raw` = the test-utils `statelessFetch`) against `application/ld+json` + `.json()` responses — i.e. they already test the target pattern, not `.dataset()`.
- `data-registry.ts:86-88` `storageIri()` is the **exact template** for `findResourceOwner`:
  ```ts
  const storageDescriptionIri = await discoverStorageDescription(data.id, factory.fetch.raw)
  const doc = await fetchJsonLd(storageDescriptionIri, factory.fetch.raw)
  return findNodeIdByType(doc, SPACE.Storage.value, storageDescriptionIri)
  ```

---

## Phase 0 — Move generic JSON-LD helpers from data-model → utils

New file **`packages/utils/src/jsonld.ts`** (exported from `packages/utils/src/index.ts`), containing everything generic — depends only on `WhatwgFetch` + `localDocumentLoader`, both already in utils:

- `fetchJsonLd(iri, fetch)` — raw GET, `Accept: application/ld+json`, throws on `!ok`
- `toStore(doc, base?)` — `jsonld.toRDF` → N3 `Store` (overlaps with utils' `parseJsonld(text, source)` — same `toRDF`+Store machinery, one takes text, one takes a doc; **optional consolidation**, not required)
- `documentValues(doc, iri, predicate)` — expand + recursive walk, collect predicate values
- `findNodeIdByType(doc, typeIri, base?)` — expand + walk, first node `@type` match → `@id`
- `frameDoc(doc, context, iri)`, `buildFrame(context, iri)`, `frameDataset(dataset, context, iri)`, `framedValue(value)`
- `expandedJsonLd(doc)`, `putJsonLd(iri, fetch, doc, headers?)`
- `JsonLdContext` type
- `documentLoader` re-export (`localDocumentLoader` already in `utils/src/jsonld-parser.ts`)

**Stays in data-model** (`packages/data-model/src/jsonld-utils.ts`):
- `linkedIrisJsonLd` — hardcodes `dataModelContext` (data-model-specific; could be parameterized later, not now)
- `dataModelContext` (in `context.ts`), `withContext` (trivial, only used by data-model write paths)

Mechanics: data-model's `jsonld-utils.ts` becomes a thin **re-export shim** pointing the moved names at `@janeirodigital/interop-utils` (keeps the ~40 test files and src imports untouched — minimal diff); the `documentLoader` const already in utils replaces data-model's local copy. Delete the moved implementations from data-model.

**Verify alone**: `npm run build` + `npm test` — zero behavior change.

---

## Phase 1 — Convert the `.dataset()` consumers + discovery functions

### 1a. `discoverAuthorizationAgent` — `packages/utils/src/discovery.ts:50-57`

```ts
// before
export async function discoverAuthorizationAgent(webId: string, rdfFetch: RdfFetch) {
  const userDataset = await (await rdfFetch(webId)).dataset()
  return getOneMatchingQuad(userDataset, DataFactory.namedNode(webId),
    INTEROP.hasAuthorizationAgent, null)?.object.value
}
// after
export async function discoverAuthorizationAgent(webId: string, fetch: WhatwgFetch) {
  const doc = await fetchJsonLd(webId, fetch)
  return (await documentValues(doc, webId, INTEROP.hasAuthorizationAgent.value))[0]
}
```

Alternative if quad semantics are preferred: `toStore(doc, webId)` + `getOneMatchingQuad` — but `documentValues` avoids the Store round-trip; the WebID doc's `hasAuthorizationAgent` lives on the webId node.

### 1b. `findResourceOwner` — `packages/authorization-agent/src/authorization-agent.ts:188-192`

Copy `data-registry.storageIri` verbatim (same operation, JSON-LD style):

```ts
const storageDescriptionIri = await discoverStorageDescription(resourceId, this.rawFetch)
const doc = await fetchJsonLd(storageDescriptionIri, this.rawFetch)
const storageRoot = await findNodeIdByType(doc, SPACE.Storage.value, storageDescriptionIri)
return this.findResourceServerOwner(storageRoot)
```

(`SPACE` imported from `@janeirodigital/interop-utils`; `getStorageRoot` from `utils/match.ts` becomes unused → removed in Phase 2.)

### 1c. Convert the remaining manual `fetch`+`parseJsonld`+`getOneMatchingQuad` in `discovery.ts`

These already take `WhatwgFetch` but do the JSON-LD dance by hand — switch to the shared helpers (removes `parseJsonld`/`getOneMatchingQuad`/`DataFactory` imports from discovery.ts):

- `discoverDelegationIssuanceEndpoint(webId, fetch)` — **also fixes the latent global-`fetch` bug** (currently `fetch(uasId, …)` ignores the injected fetch; breaks under mocks). Becomes `fetchJsonLd(uasId, fetch)` + `documentValues(doc, uasId, INTEROP.hasDelegationIssuanceEndpoint.value)`.
- `discoverAuthorizationRedirectEndpoint(authzAgentIri, fetch)` → `fetchJsonLd` + `documentValues(doc, null?, …)` — note: value is on the authz-agent node; keep the same subject matching the old quad query.
- `discoverWebPushService(authzAgentIri, fetch)` → `fetchJsonLd` + `documentValues` for `INTEROP.pushService` and `NOTIFY.vapidPublicKey` (first match each).

### 1d. Update the discovery callers (signature change → pass the raw fetch)

`discoverAuthorizationAgent` callers (8): pass `WhatwgFetch` instead of `RdfFetch`:

| Site | Change |
|---|---|
| `packages/application/src/application.ts:72` | `this.fetch` → `this.rawFetch` |
| `packages/components/src/GrantIssuanceHandler.ts:48`, `SaiPermissionsEngine.ts:50`, `AdminPermissionReader.ts:56`, `temporal/activities/grants.ts:222,232` | `fetchWrapper(fetch)` → `fetch` (drop the wrapper import) |
| `packages/data-model/src/crud/agent-registry.ts:174`, `crud/social-agent-registration.ts:120` | `factory.fetch` → `factory.fetch.raw` |
| `test/discovery.test.ts:22`, `test/reciprocal-webhook.test.ts:28` | `fetchWrapper(fetch)` → `fetch` |

`discoverDelegationIssuanceEndpoint` caller: `packages/components/src/temporal/activities/grants.ts:284` — `session.fetch` → `session.fetch.raw`.

### 1e. Pinning tests first (before any conversion in this phase)

Write the unit tests that pin the current behavior **before** the conversions below — they pass against the current code, then guard the conversions. All run under `npm test` (vitest, packages):

- **`packages/utils/test/discovery.test.ts`** (new):
  - `discoverAuthorizationAgent`: WebID doc with `interop:hasAuthorizationAgent` → agent IRI; without it → `undefined`. Mock: `vi.fn` returning `{ ok: true, json: async () => doc }`.
  - `discoverDelegationIssuanceEndpoint`: assert the **injected** fetch is used (mock records calls; doc with `hasDelegationIssuanceEndpoint`) — guards the global-`fetch` bug fix in 1c.
  - `discoverAuthorizationRedirectEndpoint` / `discoverWebPushService`: port the integration assertions (found + `undefined` cases).
- **Storage-description path**: `DataRegistry.storageIri` unit test (mock: HEAD Link → storage-description IRI, GET → `space:Storage` doc; expect the storage root) — pins the template that `findResourceOwner` (1b) copies. A full `AuthorizationAgent.findResourceOwner` test needs the registry fixtures and is heavier — optional.
- **`fetchJsonLd` / `documentValues`** direct unit tests in utils (Accept header, `!ok` throws; predicate-value collection) — standalone coverage for the moved helpers.

After 1a–1d, **no production code calls `.dataset()`** and `discovery.ts` no longer imports `./fetch`.

**Green check after Phase 1**: `npm run build` + `npm test` — the new unit tests pass both before and after the conversions; the ~40 data-model tests (already on the `fetchJsonLd` pattern via `.raw`) stay green; the `test/` workspace edits are `tsc --noEmit`-checked locally, dagger later.

---

## Phase 2 — Delete `fetch.ts`, collapse `RdfFetch` → `WhatwgFetch` ✅ done

> This phase is one atomic change: `RdfFetch` and `.raw` are mutually dependent (removing the type breaks every `.raw` caller, removing `.raw` breaks the type), so the sweep + type change + test-utils mock change must land together. Turbo's workspace dependency order builds test-utils before its consumers, so the mock change is safe in the same phase.

1. **Relocate `WhatwgFetch`** (it survives the cleanup): new `packages/utils/src/whatwg-fetch.ts` (or fold into `jsonld.ts`), exported from `utils/src/index.ts`. All existing `@janeirodigital/interop-utils` imports keep working.
2. **Delete `packages/utils/src/fetch.ts`** and remove `export * from './fetch'` from `utils/src/index.ts`.
3. **Type plumbing** (`packages/data-model`):
   - `src/index.ts`: `FactoryDependencies.fetch: RdfFetch` → `WhatwgFetch` (drop the `RdfFetch` import)
   - `base-factory.ts`: `fetch: RdfFetch` → `WhatwgFetch`; `application-factory.ts`, `authorization-agent-factory.ts` follow
4. **Sweep `factory.fetch.raw` → `factory.fetch`** (~30 sites, mechanical): `base-factory.ts` (all loaders + `shapeTree`), `authorization-agent-factory.ts`, `crud/agent-registry.ts`, `crud/registry-set.ts`, `crud/data-registry.ts`, `crud/authorization-registry.ts`, `crud/role-registry.ts`, `crud/agent-registration.ts`, `data-instance.ts` (`fetch.raw(iri, { method: 'HEAD' })` → `fetch(...)`, `fetchJsonLd(..., factory.fetch.raw)` → `factory.fetch`), `shape-tree.ts:121`, `access-need.ts:77`, `access-need-group.ts:62`, `access-description-set.ts:92`, components (`ReciprocalWebhookStore.ts` `...raw` spread, `services/AgentRegistry.ts:207`, `InvitationHandler.ts:87`, `temporal/activities/grants.ts:129`).
   - `data-instance.ts` `discoverDescriptionResource(iri, fetch: InteropFactory['fetch'])` → `WhatwgFetch`.
5. **Merge `rawFetch` + `fetch` in the session classes**:
   - `Application` (`application.ts`): single `fetch: WhatwgFetch` (dependencies already provide one); `discoverAgentRegistration(authorizationAgentIri, this.rawFetch)` → `this.fetch`, etc.
   - `AuthorizationAgent` (`authorization-agent.ts`): same merge; after 1b there is no wrapper-specific use left.
6. **Direct `factory.fetch(...)` call sites** (`crud/container.ts`, `crud/role-registry.ts:69`, `authorization.ts:102`, `grants.ts:202,288`) — no code change, they just become plain `WhatwgFetch` calls with the type change.
7. **`test-utils/fetch-mock.ts`**: `createFetch(): RdfFetch` → return the `WhatwgFetch` directly (drop `fetchWrapper`); `export const fetch = statelessFetch` (was `fetchWrapper(statelessFetch)`). Mock already serves `application/ld+json` with `.json()` — compatible with `fetchJsonLd`.
8. **Delete dead code**: `getStorageRoot` in `utils/src/match.ts` (unused after 1b — check tests first); remove the `toStore` doc comment referencing the `dataset` option (`data-model/src/jsonld-utils.ts`).

**Green check after Phase 2**: `npm run build` + `npm test`; `npm run check` (biome) on touched files; grep for leftover `RdfFetch|fetchWrapper|\.raw\b|dataset(` in `src/` must come back clean except intentional matches.

> **Executed together with Phase 3** (required — deleting `fetch.ts` breaks compilation of the affected tests, so the test updates had to land in the same change):
> - All Phase 3 items below were completed in this change; no separate Phase 3 pass is needed.

---

## Phase 3 — Test cleanup (deletions/updates required by the removal) ✅ done (absorbed into Phase 2)

All coverage *additions* already landed in Phase 1e; this phase only removes/updates tests that exercised the deleted wrapper.

1. **`packages/utils/test/fetch.test.ts`** — delete (tests the removed wrapper). Behaviors worth re-asserting live on in the new `fetchJsonLd` tests (Accept header) and `parseJsonld`/`parseTurtle` round-trip tests (already exist).
2. **`packages/data-model/test/readable/access-description-set.test.ts:35`** — the only data-model test using `.dataset()`:
   `(await factory.fetch(accessNeedIri)).dataset()` → `toStore(await fetchJsonLd(accessNeedIri, factory.fetch))`
3. **`RdfResponse` casts** → plain `Response`: `packages/application/test/application.test.ts:22,51`, `packages/data-model/test/crud/social-agent-registration.test.ts:89`, `crud/container.test.ts:57`, `readable/client-id-document.test.ts:29`, `base-factory.test.ts` (the `.raw`-shaped mock → plain fetch mock; its comment "Build an RdfFetch-compatible mock" goes away).
4. `RdfFetch` type imports removed from tests (`base-factory.test.ts`, `client-id-document.test.ts`, `application.test.ts`, `data-model/src/index.ts`-dependent files).

**Green check after Phase 3**: `npm run build` + `npm test`.

---

## Phase 4 — Delete `data-model/src/jsonld-utils.ts` (the re-export shim) ✅ done

After Phase 0, `jsonld-utils.ts` was a mix of (a) a re-export shim for the 12 helpers moved to `@janeirodigital/interop-utils`, (b) `linkedIrisJsonLd` (the only genuinely data-model-specific helper — hardcodes `dataModelContext`), and (c) `withContext` (trivial generic helper — resolves the carried-over open item, since it *is* shared: `authorization-agent` imports it). This phase deletes the file wholesale:

1. **`withContext` → utils** — added to `packages/utils/src/jsonld.ts` (next to `putJsonLd`), exported via `export * from './jsonld'`. `JsonLdContext` was already in utils.
2. **`linkedIrisJsonLd` → `context.ts`** — the natural home (it hardcodes `dataModelContext`, which lives there); `context.ts` now imports `JsonLdContext`/`WhatwgFetch`/`fetchJsonLd`/`frameDoc` from `@janeirodigital/interop-utils`. Kept in data-model's public API (`export { dataModelContext, iriTermDef, linkedIrisJsonLd } from './context'`).
3. **19 importers in `data-model/src` updated** — moved helpers (`fetchJsonLd`, `frameDoc`, `framedValue`, `documentValues`, `findNodeIdByType`, `putJsonLd`, `toStore`, `JsonLdContext`) now import from `@janeirodigital/interop-utils` (merged into the existing per-file interop-utils import); `linkedIrisJsonLd` from `./context`/`../context`; `withContext` from `@janeirodigital/interop-utils`.
4. **External consumers updated to import from `@janeirodigital/interop-utils` directly** — `authorization-agent/src/authorization.ts` (`putJsonLd`, `withContext`), `components/temporal/activities/grants.ts` (`expandedJsonLd`), and 6 data-model test files (`toStore`, `fetchJsonLd`, `frameDoc`, `withContext`). `dataModelContext` stays a data-model import everywhere.
5. **`index.ts:48` `export * from './jsonld-utils'` deleted** — data-model's public surface drops the generic helper re-exports (they belong to interop-utils; that is the direction of this whole cleanup). `linkedIrisJsonLd` stays public via `./context`.
6. **File deleted**; stale comment in `test/framing/helpers.ts` fixed.

**Green check after Phase 4**: `npm run build` + `npm test`; biome on touched files — only the pre-existing intentional `noDelete` in `data-instance.ts` remains.

---

## Verification (per phase)

Each phase ends with a green check — `npm run build` (turbo) + `npm test` (turbo, packages) — before moving on:

1. **Phase 0**: no behavior change expected; all existing tests must pass unchanged (helpers moved + re-export shim).
2. **Phase 1**: pinning tests (1e) pass before the conversions and after; the ~40 data-model tests already on the `fetchJsonLd` pattern stay green; `npm run check` (biome) on touched files.
3. **Phase 2**: build + full test suite; grep for leftover `RdfFetch|fetchWrapper|\.raw\b|dataset(` in `src/` must come back clean except intentional matches.
4. **Phase 3**: build + full test suite.

**`test/` integration workspace** (`dagger:test`, dockerized CSS/Postgres/Quadstore) is **not** part of `npm test` (no `test` script — turbo skips it). Its edits (`test/discovery.test.ts`, `reciprocal-webhook.test.ts` in Phase 1) are checked locally with `npx tsc --noEmit` in `test/` and by the dagger suite as the final gate whenever the docker stack is available.

## Carried-over open items

- **`access-description-set.ts`** is the last quad-based island in data-model (`forAccessNeed`, `findInLanguage`, `loadDescriptions` use `parseJsonld` + `DatasetCore`). Functionally unaffected by this plan (it uses `parseJsonld`), but converting it to `frameDoc`/`documentValues` is a natural follow-up, out of scope here.
- **`parseJsonld` vs `toStore`** overlap in utils — optional consolidation, not required.
- **`linkedIrisJsonLd`** lives in `context.ts` (data-model-specific, hardcodes `dataModelContext`); could be parameterized (`linkedIrisJsonLd(iri, fetch, term, context)`) and moved to utils later if it ever leaves data-model. (`withContext` **was moved to utils in Phase 4** — resolved.)
