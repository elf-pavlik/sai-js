# Plan: Refactor remaining data-model classes to POJOs (4 phases + optional JSON-LD migration + test-infra consolidation)

## Goal

Continue the POJO migration already completed for Data Grants (`simplify-grant-as-pojos.md`) and Data Authorizations (`remove-access-authorization-indirection.md`) by converting the remaining class-based resources in `packages/data-model` to plain JSON objects (POJOs) with behavior moved to module-level free functions.

The refactor happens in **four independent phases**. After each phase the whole monorepo compiles and all tests pass, so each phase can be merged and verified on its own. An optional **Phase 5** then moves the wire format from Turtle to JSON-LD (the POJO layer already speaks JSON-LD; Phase 5 converts the remaining class-layer reads/writes and the test fixtures). An independent **Phase 6** consolidates the test infrastructure: it removes the file-backed data-pod fixtures and the in-process CSS test server used by package tests, moving all server-backed tests into the root `test/` directory with `registry.trig` as the single fixture source.

## The established pattern (from the two prior migrations)

Every resource becomes a POJO via:

1. **POJO type** (`XxxData` / `FinalXxxData`); `id` is **required** on every resource POJO — only `GrantData` has the optional-`id` + `FinalGrantData` split (see decision 16)
2. **JSON-LD context** (`xxx-context.ts`) — used by `fromDataset`/`fromJsonLd` (read) and `toDataset`/`toJsonLd` (write); shared framing/RDF helpers live in `jsonld-utils.ts`
3. **Behavior as free functions** taking `(data, factory)` as the first parameters
4. **Factory methods return POJOs** (`factory.readable.xxx()` / `factory.crud.xxx()`)
5. Old classes deleted; `Memoize` decorators disappear (POJO fields are plain properties)
6. Index exports updated (keep type aliases during migration, e.g. `export type DataGrant = GrantData`)

No `instanceof` checks remain in consumers (purged during the earlier migrations), so dispatch-based code is unaffected.

## Consumer footprint (what drives the phasing)

| Package | Uses from data-model | Refactor surface |
|---------|----------------------|------------------|
| `packages/application` | `ApplicationFactory`, `DataOwner` (`.iri`, `.issuedGrants`), `ReadableApplicationRegistration` (type + `.getDataGrants()`), `factory.readable.dataRegistration(…)` (`.contains`), `Grant.iriForNew` | Small — fully converted by Phase 2 |
| `packages/authorization-agent` | Nearly everything: `factory.readable.{shapeTree, dataRegistration, webIdProfile, dataInstance}`, `registrySet.hasAgentRegistry.find*`, `hasRoleRegistry.roles`, `hasAuthorizationRegistry.dataAuthorizations/findDataAuthorizations`, `dataRegistry.storageIri()`, `socialAgentRegistration.reciprocalRegistration`, `registration.registeredAgent`, `dataInstance.dataRegistration.*`, role/invitation fields | Largest — touched by every phase |
| `packages/components` | `ApplicationFactory`, `factory.readable.clientIdDocument` (`doc.hasAccessNeedGroup`), `ReadableAccessNeed/Group` (`.getDescription()`, `.shapeTree`, `.children`, `.accessNeeds`, `.required`, `.accessMode`), `CRUDDataRegistry` (`.registrations`, `.storageIri`, `.iri`), CRUD registration types (field reads only), grant/authorization POJOs | Medium — Phase 1, 3, 4 |

Root integration tests (`test/*.ts`) only import the already-stable POJO exports `getGranted`, `GrantData`, `getDataGrants`, `getDataGrantIris` — they are unaffected as long as those exports are kept.

## Classes that never become POJOs

- **Factories** — `BaseFactory`, `AuthorizationAgentFactory`, `ApplicationFactory` (DI seams; they *return* POJOs)
- **`Resource` / `ReadableResource`** — the dataset read helpers all getters are built on (stays, or dissolves into `jsonld-utils`-style helpers)
- **`CRUDResource` / `CRUDContainer`** — the SPARQL patch/create/update/delete/timestamps plumbing (Phase 4 keeps them as the write layer)
- **`DataInstance`** (`src/data-instance.ts`) — the one remaining stateful write object (`draft`, `parent`, dataset, blob update/delete); Phase 3 adapts its internals to POJOs but keeps the class

## Current state (baseline)

- `packages/data-model`: 202 tests passing
- `packages/application`: 7 passing / 13 skipped
- `packages/authorization-agent`: tests are `describe.skip`-gated (server-dependent) — the gate for this package is **typecheck/build**
**Updated after Phase 3 (current):** data-model 199 pass / 11 skip / 10 todo; application 7 pass / 13 skip; authorization-agent gate is typecheck/build; root integration tests unaffected (stable POJO imports only). (The pre-Phase-1 baseline said 202; Phases 1–2 removed redundant `toBeInstanceOf` tests, and Phase 3 kept test counts identical — no tests were dropped by it.)

---

# Phase 1 — Leaf document POJOs ✅ DONE

Smallest blast radius. No cross-resource orchestration; these are pure property extraction over a fetched dataset.

## Classes to convert

| Class | POJO type | Fields |
|-------|-----------|--------|
| `ReadableWebIdProfile` | `WebIdProfileData` | `id`, `label?`, `oidcIssuer?` |
| `ReadableClientIdDocument` | `ClientIdDocumentData` | `id`, `callbackEndpoint?`, `hasAccessNeedGroup?`, `clientName?`, `logoUri?` (keep the `application/ld+json` fetch) |
| `ReadableShapeTreeDescription` | `ShapeTreeDescriptionData` | `id`, `label`, `definition?` |
| `ReadableAccessDescription` (abstract) | `AccessDescriptionData` | `id`, `label`, `definition?` |
| `ReadableAccessNeedDescription` | `AccessNeedDescriptionData` (`AccessDescriptionData` + `hasAccessNeed`) | |
| `ReadableAccessNeedGroupDescription` | `AccessNeedGroupDescriptionData` (`AccessDescriptionData` + `hasAccessNeedGroup`) | |
| `ReadableAccessDescriptionSet` | `AccessDescriptionSetData` | `id` (the split is derived — see free fns below) |

## Steps (all done)

- [x] **Create modules** (type + context + from/to + free fns):
  - `src/web-id-profile.ts`, `src/client-id-document.ts`, `src/shape-tree-description.ts`
  - `src/access-description.ts` — shared context + `AccessDescriptionData` base type + `AccessNeedDescriptionData` / `AccessNeedGroupDescriptionData`
  - `src/access-description-set.ts` — `AccessDescriptionSetData` (`{ id }` only; the split is **derived, not stored**) + pure fns over the set's dataset: `forAccessNeed(dataset, setIri)`, `forAccessNeedGroup(dataset, setIri)` (quad match on `inAccessDescriptionSet` + `hasAccessNeed`/`hasAccessNeedGroup` presence), `findInLanguage(dataset, lang)` (from the static), `loadDescriptions(set, factory)` (fetches the set's dataset, applies the split fns, resolves description POJOs). **No `fromDataset`/`fromJsonLd`** — the derived reverse split can't round-trip.
- [x] **Factory** — `factory.readable.{webIdProfile, clientIdDocument, shapeTreeDescription, accessNeedDescription, accessNeedGroupDescription, accessDescriptionSet}` return POJOs. `shapeTreeDescription` was added to `BaseReadableFactory` (needed by `ReadableShapeTree.getDescription`). Reads are raw fetch (`Accept: application/ld+json`) + `fromJsonLd`; `accessDescriptionSet` just returns `{ id }` (descriptions resolved on demand via `loadDescriptions`).
- [x] **data-model internals** (composites stay classes, just return POJOs):
  - `ReadableShapeTree.getDescription(lang)` → `Promise<ShapeTreeDescriptionData | null>`
  - `ReadableAccessNeed.getDescription(lang)` → `AccessNeedDescriptionData | undefined`; same for `ReadableAccessNeedGroup`
  - `CRUDAgentRegistry.addApplicationRegistration`: harvest `ClientIdDocumentData` fields (`clientName`, `logoUri`, `hasAccessNeedGroup`, `hasAuthorizationCallbackEndpoint`) instead of copying quads from the class
- [x] **Consumers:**
  - `packages/authorization-agent` — `this.webIdProfile` type → `WebIdProfileData`
  - `packages/components` — no src changes needed (field accesses unchanged, types inferred)
  - `examples/vuejectron` — `store/app.ts` `loadAgents`: `profile.iri` → `profile.id` (the POJO exposes `id`, not the deleted class's `iri`; without this the agent links lost their `agent` query param)
- [x] **Delete old classes**: `readable/webid-profile.ts`, `readable/client-id-document.ts`, `readable/shape-tree-description.ts`, `readable/access-description.ts`, `readable/access-need-description.ts`, `readable/access-need-group-description.ts`, `readable/access-description-set.ts`
- [x] **Tests** — see outcome notes below
- [x] **Verify:** data-model test suite green (200 pass / 11 skip / 10 todo); `tsc -b` passes for data-model, authorization-agent, application, components; data-model rollup build succeeds

### Test outcomes (what each file actually needed)

- `webid-profile.test.ts` — **passed unchanged** (POJO `.label`/`.oidcIssuer` field access matches)
- `client-id-document.test.ts` — mock fix only: `raw` must provide `json()` (new factory path reads the JSON-LD body directly); `text()` was for the old `parseJsonld` path
- `shape-tree-description.test.ts` — `ReadableShapeTreeDescription.build(...)` → `factory.readable.shapeTreeDescription(...)`
- `access-need-description.test.ts` / `access-need-group-description.test.ts` — dropped the redundant `toBeInstanceOf(<deleted class>)` test; the getters tests pass unchanged on the POJO
- `access-description-set.test.ts` — `toEqual({ id })`; `AccessDescriptionSet.loadDescriptions(set, factory)` for the split; `AccessDescriptionSet.findInLanguage(accessNeed.dataset, lang)` (dataset, not resource — this call broke in Phase 3 when `AccessNeedData` lost `.dataset`; see Phase 3 step 6)
- `readable/{shape-tree, access-need, access-need-group}.test.ts` — passed **unchanged** (composite classes now return POJOs from `getDescription`)

---

# Phase 2 — Application-facing data-discovery POJOs

After this phase the **application package is fully converted**.

## Classes to convert

| Class | POJO type | Fields |
|-------|-----------|--------|
| `ReadableDataRegistration` | `DataRegistrationData` | `id`, `registeredShapeTree`, `contains: string[]` — **no `shapeTree` property** (dropped: `iriPrefix` is no longer needed; consumers fetch the shape tree via `factory.readable.shapeTree(...)`) |
| `ReadableApplicationRegistration` | `ApplicationRegistrationData` | `id`, `registeredAgent`, `hasDataGrant: string[]`, `granted` |
| `ReadableContainer` | folded | no readable-side replacement needed — `iriForContained` stays only on `CRUDContainer`; the sole readable user was `ReadableApplicationRegistration` itself |
| `DataOwner` | `DataOwnerData` | `iri`, `issuedGrants: GrantData[]` |

## Steps

1. **Create modules:**
   - `src/data-registration.ts` — `DataRegistrationData` + `fromDataset`/`fromJsonLd`/`toDataset`/`toJsonLd`
   - `src/application-registration.ts` — `ApplicationRegistrationData` + `getDataGrants(data, factory): Promise<GrantData[]>` (pattern already exists as `crud/agent-registration.getDataGrants`) and `getGranted(data)`
   - `src/data-owner.ts` — `DataOwnerData` + `selectRegistrations(owner, shapeTree, factory): ReadableDataRegistrationProxy[]` free fn
2. **Factory** — `factory.readable.{dataRegistration, applicationRegistration}` return POJOs.
3. **data-model internals** (still classes, adapted in place):
   - `ReadableDataInstance.buildDataRegistration` gets a POJO; its `bootstrap` now **always** resolves `this._shapeTree` explicitly via `await factory.readable.shapeTree(reg.registeredShapeTree)` (the old `ReadableDataRegistration.shapeTree` eager property is gone); `label`/`shapeTree`/`isBlob`/`buildChildrenInfo` read from `_shapeTree`
   - `CRUDDataRegistry.registrations` → `AsyncIterable<DataRegistrationData>`; `registeredShapeTrees()` fetches `factory.readable.shapeTree(reg.registeredShapeTree)` itself **and keeps returning `ReadableShapeTree[]`** (repl's `cli.ts` maps `({ iri }) => iri`); `createRegistration` still returns the `CRUDDataRegistration` class in this phase
   - `AgentRegistrationGetters` mixin stays (still used by `CRUDAgentRegistration` until Phase 4); readable side stops using it
   - All `.iri` reads on data registrations become `.id` — incl. internal `data-authorization.ts` (`generateChildSourceGrantData`, `generateSourceDataGrants` match/fill `hasDataRegistration`)
4. **Consumers:**
   - `packages/application` — `DataOwner` → `DataOwnerData` (`getDataOwnersAsync` builds POJOs); `hasApplicationRegistration.getDataGrants()` → `getDataGrants(reg, factory)`; `dataRegistration.contains` unchanged (POJO field)
   - `packages/authorization-agent` — POJO fields: `registeredShapeTree`/`contains` unchanged, **`.iri` → `.id`** (`findAgentsWithAccess`, `formatAuthorization`, `findDataRegistrationForResource`)
   - `packages/components` — `services/Authorization.ts` (`findUserDataRegistrations` `.iri` → `.id`; the line ~102 read returns POJO, `.contains` unchanged) and `services/DataRegistry.ts` (`buildDataRegistry` `.iri` → `.id`)
5. **Delete old classes:** `readable/data-registration.ts`, `readable/application-registration.ts`, `readable/container.ts`, `data-owner.ts` (class)
6. **Tests:** rewrite `readable/{data-registration, application-registration}.test.ts`, `data-owner.test.ts`; adapt `base-factory.test.ts` ("builds application registration"), `crud/data-registration.test.ts` (dataset count 8 → 7 — the removed `iriPrefix` fixture quad), `crud/data-registry.test.ts` (`registrations` now yields POJOs), `application.test.ts` (two `instanceof` checks → POJO field assertions). **No changes needed:** `readable/data-instance.test.ts` (passed unchanged) and `authorization-agent.test.ts` (skip-gated; uses `ReadableDataRegistration` only as a type in a cast).
7. **Verify:** same as Phase 1

---

# Phase 3 — Shape-tree cluster

Converts the composite readable layer (shape tree + access needs + readable data instance). Components' access-need API is converted here.

## Classes to convert

| Class | POJO type | Notes |
|-------|-----------|-------|
| `ReadableShapeTree` | `ShapeTreeData` | `id`, `shape?`, `describesInstance?`, `expectsType?`, `descriptionLanguages: string[]`, `references: ShapeTreeReference[]` |
| `ReadableAccessNeed` | `AccessNeedData` | `id`, `registeredShapeTree`, `inheritsFromNeed?`, `hasInheritingNeed: string[]`, `accessMode: string[]`, `required: boolean`, `children: AccessNeedData[]`, `descriptionLanguages: string[]` |
| `ReadableAccessNeedGroup` | `AccessNeedGroupData` | `id`, `hasAccessNeed: string[]`, `accessNeeds: AccessNeedData[]` |
| `ReadableDataInstance` | `DataInstanceData` | `id`, `shapeTreeIri?`, `label?`, `isBlob: boolean`, `children: ChildInfo[]`, `dataRegistration?: DataRegistrationData` |

## Steps

1. **Create modules** (all behavior as free fns):
   - `src/shape-tree.ts` — `ShapeTreeData` + `getDescription(tree, lang, factory)`, `getPredicateForReferenced(tree, shapeTree)`, `expectsType(tree)`; `references` **and** `descriptionLanguages` are extracted in `fromDataset`/`fromJsonLd` (framing can't capture them: references are blank-node structures, `descriptionLanguages` live on other subjects in the document)
   - `src/access-need.ts` — `AccessNeedData` + `getDescription(need, lang, factory)`, `reliableDescriptionLanguages(need, factory)` (needs shape tree languages); `descriptionLanguages` extracted from whole-document quads (child loading happens in the factory, see step 2)
   - `src/access-need-group.ts` — `AccessNeedGroupData` + `getDescription(...)`, `reliableDescriptionLanguages(...)` (reduce across needs)
   - `src/data-instance.ts` (the existing write-side class file — no separate readable module) — `DataInstanceData` + `ChildInfo`, `label(data, factory)`, `isBlob(shapeTree)`, `buildChildrenInfo(data, factory, lang)`, `fetchDataInstanceDataset(iri, factory)`, `discoverDescriptionResource(iri, fetch)`; `isBlob: boolean` is an eagerly-computed POJO field, not a behavior fn on the data
2. **Factory** — `factory.readable.{shapeTree, accessNeed, accessNeedGroup, dataInstance}` return POJOs. `accessNeed`/`accessNeedGroup` recursively load `children`/`accessNeeds` here (from `hasInheritingNeed`/`hasAccessNeed`). Note: the `descriptionLang?` params on `shapeTree`/`accessNeed`/`accessNeedGroup` are now vestigial — descriptions are fetched on demand via the `getDescription` free fns — only `dataInstance(iri, shapeTreeIri?, descriptionLang?)` uses it (eager `label`/`children`); consider dropping the dead params in a follow-up.
3. **`DataInstance` (src) stays a class** — the write-side active record. Adapt internals only:
   - `this.shapeTree.expectsType` → ShapeTree module fn; `this.shapeTree.getPredicateForReferenced(...)` → module fn; `shapeTree` field type → `ShapeTreeData` (loaded via `factory.readable.shapeTree`)
4. **Consumers:**
   - `packages/authorization-agent` — `shapeTree.id` (POJO field), `dataInstance.dataRegistration!.registeredShapeTree/.id` (POJO fields); `findAgentsWithAccess`/`formatAgentWithAccess`/`getAccessDetails` adaptations
   - `packages/components` — `services/Authorization.ts` `formatAccessNeed`/`formatAccessNeedGroup`: `accessNeed.getDescription(lang)` → `AccessNeed.getDescription(need, lang, factory)`; the shape tree description is fetched via `factory.readable.shapeTree(need.registeredShapeTree)` + `ShapeTree.getDescription(...)` — `AccessNeedData` has **no `.shapeTree` object**, only the `registeredShapeTree: string` IRI (same pattern in `DataRegistry.ts`/`ShareResource.ts`); `.iri`/`.required`/`.accessMode`/`.inheritsFromNeed`/`.children` → POJO fields (recursion unchanged)
5. **Delete old classes:** `readable/shape-tree.ts`, `readable/access-need.ts`, `readable/access-need-group.ts`, `readable/data-instance.ts`
6. **Tests:** rewrite `readable/{shape-tree, access-need, access-need-group, data-instance}.test.ts` — `toBeInstanceOf` → `id`/POJO field assertions; `.descriptions[lang]` → `Xxx.getDescription(data, lang, factory)`; `reliableDescriptionLanguages` → free fn; `descriptionLanguages`/`reliableDescriptionLanguages` compared **sorted** (the JSON-LD roundtrip reorders quads — see Phase 5 caveat). `data-instance.test.ts` (src class) passes with one mock adaptation: its `fetchBlob` test stubs `factory.fetch.raw` with only `{ blob }`, but the adapted bootstrap now fetches the shape tree via raw + JSON-LD — the stub must delegate requests carrying `Accept` headers to the real mock. `access-description-set.test.ts` — `findInLanguage(accessNeed.dataset, lang)` no longer works (the POJO has no `.dataset`); fetch the dataset directly (`(await factory.fetch(iri)).dataset()`). `authorization-agent.test.ts` adaptations (mock instances use `id`/`dataRegistration.id`).
7. **Verify:** same as Phase 1

---

# Phase 4 — CRUD cluster

Converts the remaining write-side domain classes. The low-level write plumbing stays.

## Keep as infrastructure

- `Resource` / `ReadableResource` (read plumbing)
- `CRUDResource` / `CRUDContainer` (SPARQL patch/create/update/delete/timestamps — the value, not domain state)
- Factories

## Classes to convert

| Class | POJO type | Behavior that becomes module fns |
|-------|-----------|----------------------------------|
| `CRUDAgentRegistration` (abstract) | `AgentRegistrationData` | `setAcr(...)`, `datasetFromData` → `toDataset`; **`addDataGrant`/`removeDataGrant`/`removeAllDataGrants`/`getDataGrantIris`/`getDataGrants`/`getGranted` already exist** in `crud/agent-registration.ts` — keep |
| `CRUDApplicationRegistration` | `ApplicationRegistrationData` (crud) | reads from application node: `accessNeedGroup`, `hasAuthorizationCallbackEndpoint`, `name`, `logo` |
| `CRUDSocialAgentRegistration` | `SocialAgentRegistrationData` | `discoverReciprocal`, `updateReciprocal`, `discoverAndUpdateReciprocal`, `setAccessNeedGroup`, reciprocal link handling |
| `CRUDSocialAgentInvitation` | `SocialAgentInvitationData` | `capabilityUrl`, `prefLabel`, `note`, `registeredAgent?` |
| `CRUDRole` | `RoleData` | `label`, `members` |
| `CRUDRoleRegistry` | `RoleRegistryData` | `roles`, `createRole`, `updateRole`, `deleteRole` |
| `CRUDAgentRegistry` | `AgentRegistryData` | `applicationRegistrations`, `socialAgentRegistrations`, `socialAgentInvitations`, `find*`, `addApplicationRegistration` (Client ID harvesting + ACR), `addSocialAgentRegistration` (auth-agent discovery + ACR), `addSocialAgentInvitation` |
| `CRUDAuthorizationRegistry` | `AuthorizationRegistryData` | `dataAuthorizations`, `findDataAuthorizations`, `findAuthorizationsDelegatingFromOwner`; **`getDataAuthorizationIris`/`getGranted`/`getDataAuthorizations` already exist** — keep |
| `CRUDGrantRegistry` | `GrantRegistryData` | trivial |
| `CRUDDataRegistry` | `DataRegistryData` | `hasDataRegistration`, `registrations`, `storageIri`, `createRegistration`, `registeredShapeTrees` |
| `CRUDDataRegistration` | `DataRegistrationData` (write side; same type as Phase 2) | `datasetFromData` → `toDataset` |
| `CRUDRegistrySet` | `RegistrySetData` | `loadRegistrySet(data, factory)` resolving the five sub-registries |

`AgentRegistrationGetters` mixin is folded into the contexts and deleted.

## Steps

1. **Create modules** — one per class above, following the functional-helper pattern already in `crud/agent-registration.ts` and `crud/authorization-registry.ts`
2. **Factory** — `factory.crud.*` return POJOs; `immutable.dataGrant` unchanged
3. **Consumers:**
   - `packages/authorization-agent` — CRUD types → POJO types; method calls → module fns (`findApplicationRegistration`/`findSocialAgentRegistration`, `roles`, `dataAuthorizations`/`findDataAuthorizations`, `storageIri`, `reciprocalRegistration`, `registeredAgent`, `members`, `capabilityUrl`)
   - `packages/components` — `CRUDDataRegistry` type → `DataRegistryData` + module fns (`registrations`, `storageIri`, `iri`); CRUD registration types → POJO types (field reads unchanged)
4. **Delete old classes:** all `crud/*.ts` domain classes (keep `crud/resource.ts`, `crud/container.ts`)
5. **Tests:** rewrite `crud/{agent-registration, agent-registry, application-registration, container, data-registration, data-registry, registry-set, social-agent-invitation, social-agent-registration, access-consent-registry, resoruce}.test.ts` and `authorization-agent.test.ts`. Root integration tests unaffected.
6. **Verify:** full `turbo run test --concurrency=1` + build

---

# Phase 5 — Move the wire format from Turtle to JSON-LD (optional follow-up)

> Independent from Phases 1–4 and best done **after** them. The POJO layer already speaks JSON-LD on both read and write paths (factory reads use raw fetch + `fromJsonLd`; components' grant writes use `JSON.stringify(toJsonLd)` + `application/ld+json`). The Turtle holdouts are the class-layer remnants and the test fixtures. Real servers (CSS storage fixture, `registry.trig` quadstore) already content-negotiate JSON-LD, so **only `packages/test-utils` fixtures need conversion**.

Doing this before Phases 1–4 would require an atomic big-bang (the mock and `fetchWrapper` must flip together or every readable/CRUD test breaks) and would migrate class code that Phases 1–4 then delete.

## Wire-format inventory

| Path | Today | Phase 5 |
|------|-------|---------|
| Grant **reads** (`base-factory.dataGrant`) | JSON-LD | unchanged |
| Grant **writes** (components `storeDataGrant`) | JSON-LD | unchanged |
| Authorization **reads** | JSON-LD | unchanged |
| Authorization **writes** (`authorization.ts`) | Turtle (`toDataset` + PUT `dataset`) | JSON-LD (optional symmetry: `toJsonLd` + raw PUT) |
| `ReadableClientIdDocument` | JSON-LD | unchanged |
| `ReadableResource.fetchData` + readable classes | Turtle (via `fetchWrapper`) | deleted in Phases 1–3 |
| `CRUDResource.update` / `DataInstance.update` / `fetchStorageDescription` | Turtle (via `fetchWrapper`) | JSON-LD via `fetchWrapper` swap |
| `setAcr` (ACL) | Turtle | stays Turtle (ACL) |
| SPARQL patches (`insertPatch`/`deletePatch`) | Turtle | stays Turtle (SPARQL protocol) |
| `data.json` / `fetch-mock.ts` | Turtle | JSON-LD |

## The single lever: `packages/utils/src/fetch.ts` (in-repo interop-utils)

`@janeirodigital/interop-utils` is a **workspace package** (`packages/utils`), so `fetchWrapper` is editable in-repo. It hard-codes Turtle in three places:

- GET sets `Accept: text/turtle`
- `response.dataset()` **throws unless Content-Type matches text/turtle**, then `parseTurtle`
- PUT with `{ dataset }` serializes to Turtle, `Content-Type: text/turtle`

Change it to **JSON-LD-first with Turtle fallback**:

- GET: `Accept: application/ld+json` (still overridable via headers)
- `dataset()`: content-type aware — `application/ld+json` → `parseJsonld` (already exists in `packages/utils/src/jsonld-parser.ts`, with `localDocumentLoader` for the OIDC/notifications contexts), `text/turtle` → `parseTurtle`
- PUT `{ dataset }`: body = `JSON.stringify(await jsonld.fromRDF(dataset))`, `Content-Type: application/ld+json`

This one change migrates the entire class layer transparently: `parseJsonld` also returns an N3 `Store`, so `Resource.dataset` and all quad getters are untouched.

## Steps

1. **`fetchWrapper`** (`packages/utils/src/fetch.ts`) — JSON-LD-first as above.
2. **`packages/utils/test/fetch.test.ts`** — rewrite (currently asserts `Accept: text/turtle`, Turtle Content-Type, `dataset()` throwing on non-Turtle).
3. **`CRUDAgentRegistration.setAcr`** → switch to `fetch.raw` + `serializeTurtle(dataset)` body + explicit `Content-Type: text/turtle` (ACL resources stay Turtle; the ACR templates are ACL Turtle).
4. **`authorization-agent/src/authorization.ts`** write → optional `toJsonLd` + raw PUT for symmetry with grants (works either way once `fetchWrapper` is JSON-LD).
5. **Fixtures** (the only fixture work):
   - `packages/test-utils/src/data.json` — convert all ~110 Turtle entries to JSON-LD, mechanically (per entry: `parseTurtle(text, key)` → N3 Store → `jsonld.fromRDF` → `JSON.stringify`, expanded form). Watch-outs: the one already-JSON-LD entry (`https://auth.alice.example/`), escaped `\#` fragments become plain `#` in `@id`, bob's relative-IRI entries resolve against their base, shape-tree blank nodes (`uuid:...`) become `_:` ids. Keys stay URLs; the mock's fragment-stripping lookup is unchanged.
   - `packages/test-utils/src/fetch-mock.ts` — serve `application/ld+json` always (`json()` returns the doc, `text()` the JSON string), drop `turtleToJsonLd`, storage-description special case → JSON-LD, PUT stores the JSON-LD body verbatim so round-trips work. Keep serving Turtle for explicit `Accept: text/turtle` during the transition (e.g. `test/policy-engine.test.ts`).
   - `packages/test-utils/test/fetch-mock.test.ts` — rewrite (currently asserts `text/turtle` Content-Type).
6. **RDF content is identical** — all existing test expectations stay valid; only the serialization changes. **Caveat (learned in Phase 3):** JSON-LD roundtrips do not preserve quad *order* — the shape tree's `descriptionLanguages` came back `['de','en','pl']` instead of Turtle document order `['en','pl','de']`. Order-sensitive expectations (`descriptionLanguages`, `reliableDescriptionLanguages`) must compare sorted / order-independently; the Phase 3 readable tests already do.

## Stays Turtle by definition (the "fully JSON-LD" boundary)

- **SPARQL patches** — `insertPatch`/`deletePatch` (`CRUDContainer.add/remove/replaceStatement`, `create`, `DataInstance` blob PATCH): SPARQL Update protocol bodies are quad Turtle serializations; JSON-LD-in-SPARQL is not standard.
- **ACL/ACR resources** — `setAcr`, `templates/*.acr.ts` (WAC/ACP).
- **shex shapes** — not RDF (`solid/shapes/*.shex`, FHIR `CarePlan-shapes`).
- **(optional)** `application/src/notification-manager.ts` (`parseTurtle` on inbox notifications) — server-dependent payloads; can stay Turtle.

## Verify

- `packages/utils` tests (`fetch.test.ts` rewritten; `turtle-serializer`/`sparql-update` unchanged)
- data-model + application tests; authorization-agent typecheck; components build
- Root integration tests against the docker stack (registry.trig + CSS serve JSON-LD via content negotiation)

---

# Phase 6 — Test infrastructure consolidation (optional follow-up)

> Independent from Phases 1–5 and can land any time (before, after, or parallel to them). It touches **no data-model code** — only fixtures, test servers, and where tests live. Its two goals: (1) delete the file-backed data-pod fixtures (`packages/css-storage-fixture/test/data/` and `dev/data`) and the S3 client-id seeding in `test/setup.ts`, and (2) stop starting a live CSS server from package tests (`@janeirodigital/css-test-utils` `SolidTestUtils`), moving those integration-style tests to the root `test/` directory with `packages/css-storage-fixture/test/registry.trig` as the single fixture source.

Doing it first **narrows Phase 5's scope** (only the mock realm `data.json` needs converting; `registry.trig` stays Turtle regardless — the quadstore-backed CSS content-negotiates JSON-LD on request) and **makes the per-phase gate of Phases 1–4 server-free** (most relevant to Phase 2, which rewrites the `Application`/`DataOwner` APIs that `application.test.ts` currently exercises against a live CSS).

## Current topology (two fixture realms)

| Realm | Location | Server? | Consumers |
|-------|----------|---------|-----------|
| **Mock** | `packages/test-utils/src/data.json` + `fetch-mock.ts` | none (in-memory fetch mock) | data-model, authorization-agent, components unit tests — **stays** (Phase 5 converts it to JSON-LD) |
| **CSS server** | `packages/css-storage-fixture/test/` (pods `data/`, `solid/`, `luka/`, `vaporcg/`, … + `.internal/` accounts) | in-process CSS on `:3711` via `SolidTestUtils` (`packages/css-test-utils`) | package tests: `application/test/application.test.ts`, `utils/test/discovery.test.ts`, `repl/test/cli.test.ts` |
| **CSS server** | `packages/css-storage-fixture/dev/` (`dev/data`, `dev/pod`) | docker `data`/`auth` services + `registry` CSS (oxigraph) | root `test/*.ts` (docker stack): `setup.ts` seeds `registry.trig` → oxigraph, `kv.json` → Postgres, client id → garage S3 |

Key facts:

- `registry.trig` (loaded into oxigraph by `test/setup.ts`) **already serves 210 `https://data/...` resources** — data registries (`acme-rnd`, `acme-hr`, `alice-work`, …), instances, and even `test-client/public/access-needs`. The file-backed pods add only two things under `https://data/`: the **client id document** (`test/data/test-client/public/id$.jsonld`, currently uploaded to garage S3) and the **shapetrees pod** (`test/data/shapetrees/` + `dev/data/shapetrees/`).
- The in-process CSS server lives in `packages/css-test-utils` (not `packages/test-utils`); `test-utils` has no server, only the mock fetch + Postgres client.
- `test/data` and `dev/data` **differ** (real drift — e.g. `bob`/`www` only in `dev`, differing shex/ttl contents).
- `test/solid/trees/` (Widget/Gadget) + the `solid/`/`luka/`/… pods are a separate realm (`localhost:3711`, `solidshapes.example`) used only by the package-CSS tests; they move with those tests or get deleted with `css-test-utils`.

## Steps

1. **Move the data-pod resources into `registry.trig`** as named graphs (client id doc + `shapetrees/` trees/shapes/descriptions), so the oxigraph-backed `registry` CSS serves everything under `https://data/...`. Check `data/shapetrees/*.ttl` for blank nodes before the move (oxigraph handles them; the earlier `uuid:` blank-node concern was in the *mock* `data.json`, a different realm).
2. **`test/setup.ts`** — drop the garage S3 client-id upload (`garage.putAnyObject`/`deleteObject`); the client id is served from the quadstore.
3. **Move server-backed package tests to root `test/`**: `application.test.ts` server blocks (`describe.skip`-gated today), `utils/test/discovery.test.ts`, `repl/test/cli.test.ts`. Keep/extend the mock-based unit tests in the packages (`statelessFetch` pattern already used by `application.test.ts`) so each package keeps a server-free gate.
4. **Delete** `packages/css-storage-fixture/test/data/`, `dev/data` (check `bob`/`www` usage first), the docker `data` service if nothing file-backed remains under `https://data/`, the `.internal/` account state (if the package-CSS realm goes away), and `packages/css-test-utils` if fully unused.

## Stays as-is (boundary)

- **Mock realm** — `data.json` + `fetch-mock.ts` stay for package unit tests (Phase 5 converts them to JSON-LD).
- **`registry.trig` stays Turtle** — the quadstore seed format is independent of the client wire format; the CSS serves JSON-LD via content negotiation after Phase 5.
- **kv.json → Postgres** seeding in `setup.ts` stays (temporal workflow state).
- Widget/Gadget shape trees stay in the CSS realm while the package-CSS tests still use them.

## Verify

- Package tests (`application`, `utils`, `repl`) run **server-free** (mock fetch only).
- Root integration tests (`test/*.ts`) pass against the docker stack with `registry.trig` serving the moved resources.
- `packages/css-storage-fixture/test/data/` and `dev/data` removed; no references to `SolidTestUtils` remain.

---

## Scope of Changes (all phases)

| Package | Files |
|---------|-------|
| `packages/data-model` | New POJO modules (≈12), contexts, `jsonld-utils` reuse; `base-factory.ts`, `authorization-agent-factory.ts`; delete all readable leaf/composite and crud domain classes; `index.ts`, `readable/index.ts`, `crud/index.ts` |
| `packages/authorization-agent` | `authorization.ts`, `authorization-agent.ts` |
| `packages/components` | `services/Authorization.ts`, `services/AgentRegistry.ts`, `services/DataRegistry.ts`, `services/ShareResource.ts` |
| `packages/application` | `application.ts` |
| Tests | All data-model unit tests rewritten in their phase; `application.test.ts`, `authorization-agent.test.ts` |

### Phase 5 additions

| Package | Files |
|---------|-------|
| `packages/utils` (in-repo interop-utils) | `src/fetch.ts` (JSON-LD-first `fetchWrapper`), `test/fetch.test.ts` |
| `packages/test-utils` | `src/data.json` (turtle → JSON-LD), `src/fetch-mock.ts`, `test/fetch-mock.test.ts` |
| `packages/data-model` | `crud/agent-registration.ts` (`setAcr` → raw turtle PUT); (optional) `crud/resource.ts` / `data-instance.ts` / `crud/data-registry.ts` — transparent via `fetchWrapper` |
| `packages/authorization-agent` | `authorization.ts` (optional `toJsonLd` + raw PUT symmetry) |

### Phase 6 additions

| Package | Files |
|---------|-------|
| `packages/css-storage-fixture` | `test/registry.trig` (add client id + shapetrees graphs), delete `test/data/`, `dev/data`, `.internal/` (scope-dependent) |
| `test/` (root) | `setup.ts` (drop S3 seeding), moved tests: application server blocks, `discovery` (from `packages/utils`), `cli` (from `packages/repl`) |
| `packages/application` / `packages/utils` / `packages/repl` | tests: server-backed cases moved out, mock-based unit tests kept/extended |
| `packages/css-test-utils` | delete if fully unused |
| `docker-compose.yaml` | `data` service (if nothing file-backed remains under `https://data/`) |

## Key Design Decisions (Confirmed)

1. **Follow the established POJO pattern** — type + context + `fromDataset`/`fromJsonLd`/`toDataset`/`toJsonLd` + behavior free fns taking `(data, factory)`.
2. **`ReadableDataRegistration` POJO drops its `shapeTree` property** — consumers fetch the shape tree via `factory.readable.shapeTree(reg.registeredShapeTree)`.
3. **`DataInstance` (src) stays a class** — the write-side active record (draft/parent/blob update/delete); only internals adapt. A future phase could convert it if desired.
4. **`CRUDResource`/`CRUDContainer` stay as the write layer** — the SPARQL patch machinery is infrastructure, not domain state.
5. **Factories stay** — they are the DI seams and the ones returning POJOs.
6. **Existing functional helpers are kept and extended** — `crud/agent-registration.ts` (data grants) and `crud/authorization-registry.ts` (data authorizations) already demonstrate the target shape.
7. **Phases are independently green** — each phase updates factory signatures, consumers, tests, and exports together; `turbo run test` and build pass after each.
8. **Phase 5 (JSON-LD) is optional and comes last** — the wire-format migration is orthogonal to the POJO refactor; the POJO layer already speaks JSON-LD, so deferring it minimizes throwaway work (Phases 1–4 delete most of the Turtle-reading class layer).
9. **`fetchWrapper` becomes JSON-LD-first with Turtle fallback** — dual-format support eases the transition (ACRs, notifications, explicit Turtle `Accept` headers).
10. **Turtle stays where the protocol requires it** — SPARQL patches and ACL/ACR resources are not migrated.
11. **Phase 6 (test-infra consolidation) is an independent workstream** — it touches no data-model code, so it can land before, after, or parallel to Phases 1–5.
12. **`registry.trig` becomes the single fixture source** — the client id document and shapetrees pod move into the quadstore (named graphs), served by the existing oxigraph-backed `registry` CSS; the file-backed `data` pod, S3 client-id seeding, and the in-process `SolidTestUtils` CSS server all go away.
13. **Server-backed package tests move to root `test/`, mock-based unit tests stay in the packages** — each package keeps a server-free test gate (helps Phases 1–4, especially Phase 2's `application` conversion).
14. **`AccessDescriptionSetData` stores only `{ id }`** — the need/group split is derived data (a query over the set's dataset), extracted as pure fns `forAccessNeed(dataset, setIri)` / `forAccessNeedGroup(dataset, setIri)`; the set module has no `fromDataset`/`fromJsonLd` since the split can't round-trip. Framing can't express it either: two context terms mapping to the same `@reverse` predicate collide (jsonld throws on the resulting frame array).
15. **No `@type: '@id'` on interop context fields** (`clientIdDocumentContext` callbackEndpoint/hasAccessNeedGroup/logoUri, `webIdProfileContext` oidcIssuer, `accessDescriptionContext` hasAccessNeed/hasAccessNeedGroup) — client id docs serialize interop props as bare strings; `framedValue` unwraps every value shape (plain string, `{@value…}` literal, `{id}`/`{@id}` node ref).
16. **`id` is required on resource POJOs** — every converted resource always has an IRI: the read path fetches by a known IRI (`factory.readable.xxx(iri)` → `id: iri`) and the write path generates the IRI *before* constructing the POJO (`factory.crud.xxx(iriForContained(), data)` → `id: iri`). So `DataRegistrationData.id`, `ApplicationRegistrationData.id`, `DataInstanceData.id`, etc. are all `id: string` — **not** `id?`. The one exception is `GrantData`, where `id?: string` + `FinalGrantData` exist because *delegated grants* are embedded in the parent grant's `hasInheritingGrant` before any IRI is assigned (the delegation endpoint assigns it later, see `generateDelegatedDataGrants` / `requestDelegation`). No other resource type has such a pre-IRI state, so the `id?`/`Final*` split is **not** replicated for them.
17. **`DataRegistrationData.contains` is a required read-only field; the write side shares the same type** — `contains: string[]` (possibly `[]` for an empty registration) is always present on reads. The write side (SPARQL patch based) never writes `contains` — `ldp:contains` is server-managed LDP containment, not client-written data — and never serializes the POJO via `toDataset`/`toJsonLd` in Phase 2. There is **no separate CRUD write type**: `factory.crud.dataRegistration(iri, data?: DataRegistrationData)` takes the same `DataRegistrationData`, and the creation path (the only place a registration is built without a prior read) supplies `{ id: iri, registeredShapeTree, contains: [] }` — a brand-new container legitimately contains nothing yet.
18. **Behavior fns with colliding names export as namespaces, not top-level** — `application-registration.ts`'s `getDataGrants`/`getGranted` are exported via `export * as ApplicationRegistration`, because `crud/agent-registration.ts` already exports top-level `getDataGrants`/`getGranted`; star-exporting both at the top level would silently drop one. Consumers call `ApplicationRegistration.getDataGrants(reg, factory)`. The same namespace pattern (`export * as DataRegistration`, `export * as DataOwner`) keeps module fns discoverable without polluting the top-level scope. **Exception: `DataInstance`** — the write-side class already occupies the name, so no `export * as DataInstance` is possible; only the types (`DataInstanceData`, `ChildInfo`) are exported and the module fns are not re-exported as a namespace.
19. **Context style follows the resource's source serialization** — registry-style POJOs (`DataRegistrationData`, `ApplicationRegistrationData`, like `GrantData`) use `@type: '@id'` (plus `@container: '@set'` for arrays) on interop properties and read framed values directly (`node.registeredShapeTree`, no `framedValue`), because these resources are RDF-served with IRI values. Decision 15's *no* `@type: '@id'` rule applies only to leaf-doc POJOs (client id doc, webid profile, access descriptions) whose source documents serialize interop properties as bare strings.
20. **Module evaluation order guards against circular-import TDZ crashes** — `base-factory` imports `./data-instance` at top level (for `isBlob`/`computeLabel`/`computeChildren`), and `DataInstance extends ReadableResource extends Resource`, whose `Resource` was imported from the index. That created a live cycle at import time (`index → base-factory → data-instance → readable/resource → index(Resource)`, `Resource` uninitialized). Two fixes, both to keep in later phases (Phase 4's CRUD POJOs will be imported into the factories the same way):
   - `data-instance.ts` imports `ReadableResource` from `./readable/resource` **directly**, not through the index;
   - `index.ts` orders `export * from './resource'` + `export * from './readable'` **before** `export * from './base-factory'`, so the class dependencies evaluate before the factory that pulls in `data-instance`.
