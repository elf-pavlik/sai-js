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

Root integration tests (`test/*.ts`) import the POJO exports `getGranted`, `GrantData`, `getDataGrants`, `getDataGrantIris` — the exports survived Phase 4, but their signatures changed (`(data, factory)`, async), so `test/roles.test.ts` and `test/authorization.test.ts` needed small adaptations (see Phase 4 notes).

## Classes that never become POJOs

- **Factories** — `BaseFactory`, `AuthorizationAgentFactory`, `ApplicationFactory` (DI seams; they *return* POJOs)
- **`Resource` / `ReadableResource`** — the dataset read helpers all getters are built on (stays, or dissolves into `jsonld-utils`-style helpers)
- **`CRUDResource` / `CRUDContainer`** — the SPARQL patch/create/update/delete/timestamps plumbing (Phase 4 keeps them as the write layer)
- **`DataInstance`** (`src/data-instance.ts`) — the one remaining stateful write object (`draft`, `parent`, dataset, blob update/delete); Phase 3 adapts its internals to POJOs but keeps the class

## Current state (baseline)

- `packages/data-model`: 202 tests passing
- `packages/application`: 7 passing / 13 skipped
- `packages/authorization-agent`: tests are `describe.skip`-gated (server-dependent) — the gate for this package is **typecheck/build**
**Updated after Phase 4 (current):** data-model 193 pass / 10 skip / 10 todo (36 files); application 7 pass / 13 skip; authorization-agent gate is typecheck/build; root integration tests adapted minimally in Phase 4 (`test/roles.test.ts`, `test/authorization.test.ts` — new `(data, factory)` signatures, see Phase 4 notes). (Pre-Phase-1 baseline 202; Phases 1–2 removed redundant `toBeInstanceOf` tests; Phase 3 kept counts identical; Phase 4 dropped/restructured some CRUD tests — 4 dropped-test decision items from the previous session remain open.)
**Phase 5 (reworked) in progress — see Phase 5 section.** Wire format flipped to JSON-LD (wrapper, mock, data.json, setAcr) with all package tests unchanged (utils 40, test-utils 10, data-model 193/10/10, application 7/13); turbo build 9/9 + test 14/14. Next: convert CRUD domain modules to POJO GET/PUT (role.ts first).

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

# Phase 4 — CRUD cluster ✅ DONE

Converts the remaining write-side domain classes. The low-level write plumbing stays.

## Keep as infrastructure

- `Resource` / `ReadableResource` (read plumbing)
- `CRUDResource` / `CRUDContainer` (SPARQL patch/create/update/delete/timestamps — the value, not domain state)
- Factories

## Classes to convert

| Class | POJO type | Behavior that becomes module fns |
|-------|-----------|----------------------------------|
| `CRUDAgentRegistration` (abstract) | `AgentRegistrationData` | `setAcr(...)`, `datasetFromData` → `toDataset`; data-grant helpers **adapted to `(data, factory)`** (not merely kept — see notes): `addDataGrant`/`removeDataGrant`/`removeAllDataGrants`, and `getDataGrantIris`/`getDataGrants`/`getGranted` — the latter three now async with a dataset fallback |
| `CRUDApplicationRegistration` | `ApplicationRegistrationData` (**unified with the Phase 2 readable type** — top-level `application-registration.ts` re-exports the crud type) | reads from application node: `accessNeedGroup`, `hasAuthorizationCallbackEndpoint`, `name`, `logo` |
| `CRUDSocialAgentRegistration` | `SocialAgentRegistrationData` | `discoverReciprocal`, `discoverAndUpdateReciprocal` (`updateReciprocal` is internal, not exported), `setAccessNeedGroup`, reciprocal link handling |
| `CRUDSocialAgentInvitation` | `SocialAgentInvitationData` | `capabilityUrl`, `prefLabel`, `note`, `registeredAgent?` |
| `CRUDRole` | `RoleData` | `label`, `members` |
| `CRUDRoleRegistry` | `RoleRegistryData` | `roles`, `createRole`, `updateRole`, `deleteRole` |
| `CRUDAgentRegistry` | `AgentRegistryData` | `applicationRegistrations`, `socialAgentRegistrations`, `socialAgentInvitations`, `find*`, `addApplicationRegistration` (Client ID harvesting + ACR), `addSocialAgentRegistration` (auth-agent discovery + ACR), `addSocialAgentInvitation` |
| `CRUDAuthorizationRegistry` | `AuthorizationRegistryData` | `dataAuthorizations`, `findDataAuthorizations`, `findAuthorizationsDelegatingFromOwner`; **`getDataAuthorizationIris`/`getGranted`/`getDataAuthorizations` kept** as module fns (`getGranted` adapted to `(data, factory)`) |
| `CRUDGrantRegistry` | `GrantRegistryData` | trivial |
| `CRUDDataRegistry` | `DataRegistryData` | `hasDataRegistration`, `registrations`, `storageIri`, `createRegistration`, `registeredShapeTrees` |
| `CRUDDataRegistration` | `DataRegistrationData` (write side; same type as Phase 2) | `datasetFromData` → `toDataset` |
| `CRUDRegistrySet` | `RegistrySetData` (carries a `factory` ref; the create input is `RegistrySetDataInput`) | `loadRegistrySet(data, factory, data?)`, `updateRegistrySet(data, factory)` |

`AgentRegistrationGetters` mixin is folded into the contexts and deleted.

## Steps

1. **Create modules** — one per class above, following the functional-helper pattern already in `crud/agent-registration.ts` and `crud/authorization-registry.ts`
2. **Factory** — `factory.crud.*` return POJOs; `immutable.dataGrant` unchanged
3. **Consumers:**
   - `packages/authorization-agent` — CRUD types → POJO types; method calls → module fns (`findApplicationRegistration`/`findSocialAgentRegistration`, `roles`, `dataAuthorizations`/`findDataAuthorizations`, `storageIri`, `reciprocalRegistration`, `registeredAgent`, `members`, `capabilityUrl`)
   - `packages/components` — `CRUDDataRegistry` type → `DataRegistryData` + module fns (`registrations`, `storageIri`, `iri`); CRUD registration types → POJO types (field reads unchanged)
4. **Delete old classes:** all `crud/*.ts` domain classes (keep `crud/resource.ts`, `crud/container.ts`)
5. **Tests:** rewrite `crud/{agent-registration, agent-registry, application-registration, container, data-registration, data-registry, registry-set, social-agent-invitation, social-agent-registration, access-consent-registry, resoruce}.test.ts` and `authorization-agent.test.ts`. Root integration tests adapted minimally (`roles.test.ts`, `authorization.test.ts` — see notes).
6. **Verify:** full `turbo run test --concurrency=1` + build

### What actually happened (implementation notes)

- **Registries are exported as namespaces, registry POJO types stay top-level** — `export * as {AgentRegistry, RoleRegistry, DataRegistry, AuthorizationRegistry, GrantRegistry, RegistrySet}` plus top-level `AgentRegistryData`/`RoleRegistryData`/`DataRegistryData`/`AuthorizationRegistryData`/`GrantRegistryData`/`RegistrySetData`/`RegistrySetDataInput`. Required because every registry module defines `iriForContained` (and `getGranted`/`getDataGrants` collide between `agent-registration.ts` and `authorization-registry.ts` — `crud/index.ts` resolves that pair with explicit re-exports). Non-registry crud modules export plain top-level fns (`createApplicationRegistration`, `loadApplicationRegistration`, `createSocialAgentRegistration`, `setRegisteredAgent`, `updateSocialAgentInvitation`, `createDataRegistration`, `getDataAuthorizationIris`, `getDataAuthorizations`).
- **`RegistrySetData` carries a `factory` reference** — `{ hasAgentRegistry, hasRoleRegistry, hasDataRegistry, hasAuthorizationRegistry, hasGrantRegistry, factory: AuthorizationAgentFactory }`; the create input is `RegistrySetDataInput` (same minus `factory`). The factory ref is what lets `data-authorization.ts`'s nested-authorization generators resolve registries from a registry-set POJO.
- **`ApplicationRegistrationData` was unified, not duplicated** — the Phase 2 readable module (`src/application-registration.ts`) now re-exports the Phase 4 crud type; the crud type is `AgentRegistrationData & { hasDataGrant: string[], granted, accessNeedGroup?, hasAuthorizationCallbackEndpoint?, name?, logo? }`. The readable path (`factory.readable.applicationRegistration`) keeps filling `registeredAgent`/`hasDataGrant`/`granted`; the crud path adds the application-node reads.
- **The data-grant helpers were adapted, not just "kept"** — `getDataGrantIris`/`getDataGrants`/`getGranted` (and `authorization-registry.getGranted`) moved to `(data, factory)` signatures and became async: when a freshly loaded/created registration POJO has no `hasDataGrant` field they fall back to fetching the registration's dataset and re-extract the IRIs. Hence the root integration tests were **not** untouched: `test/roles.test.ts` (`getDataGrants(data, factory)`, `await getDataGrantIris(data, factory)`) and `test/authorization.test.ts` (`await getGranted(data, factory)`, `AuthorizationRegistry.findDataAuthorizations(reg, factory, clientId)`).
- **`updateReciprocal` is internal** — folded into `discoverAndUpdateReciprocal`; not exported. `AgentRegistrationGetters` mixin deleted as planned.
- **`factory.crud.*` surface** — `applicationRegistration`, `socialAgentRegistration`, `socialAgentInvitation`, `role`, `roleRegistry`, `dataRegistry`, `dataRegistration`, `authorizationRegistry`, `grantRegistry`, `agentRegistry`, `registrySet`; `immutable.dataGrant` unchanged.
- **`packages/repl` was in the blast radius** — `cli.ts`/`repl.ts` import the `CRUDRegistrySet` namespace and were adapted; not typechecked (no `tsc` gate) but must compile.
- **Consumer gotcha (Phase 3 interplay):** `factory.readable.dataInstance(iri, shapeTreeIri?, descriptionLang?)` only populates `label`/`children` **when `descriptionLang` is passed** (the old `ReadableDataInstance.label` getter always computed it). Components' `listDataInstances` consequently returned `label: undefined` → RPC `ParseError` (`label: S.String` is required). Fix: `ApiHandler.ts` passes `'en'` → `listDataInstances(session, agentId, registrationId, 'en')` (service param `descriptionsLang = 'en'`, threaded into both `readable.dataInstance` calls). Follow-up: add `lang` to the `ListDataInstances` payload (mirroring `ListDataRegistries`) and drop the hardcoded default.
- **Test outcome:** data-model 193 pass / 10 skip / 10 todo (36 files). A few CRUD tests were dropped rather than rewritten; restoring them in an alternative form is still pending user decision (see conversation).

---

# Phase 5 — JSON-LD wire format + POJO GET/PUT (in progress, reworked)

> **Reworked:** remaining CRUD domain resources become compacted & framed JSON-LD POJOs; their GET/PUT bypasses `fetchWrapper`:
> - GET → `fetch.raw(iri, { headers: { Accept: 'application/ld+json' } })` → `.json()` → `fromJsonLd(doc, iri)` (via `frameDoc`)
> - PUT → `fetch.raw(iri, { method: 'PUT', body: JSON.stringify(toJsonLd(data)), headers: { 'Content-Type': 'application/ld+json' } })`
>
> (Patterns already exist: base-factory readable methods; components `storeDataGrant`.) The wrapper stays **only for quad-level infra**, flipped JSON-LD-first.

## Stays on quads (keeps wrapper + `.dataset()`)

- `Resource` / `ReadableResource` / `CRUDResource` / `CRUDContainer` — quad getters, timestamps, SPARQL patches
- `DataInstance` class — `this.dataset`, blob/child-reference PATCHes
- `discoverAuthorizationAgent` (utils/discovery), `storageIri` (crud/data-registry), `fetchDataset`/`linkedIris` (crud/resource) — until each crud module converts

## Done (this session)

1. **`fetchWrapper`** (`packages/utils/src/fetch.ts`) — JSON-LD-first w/ Turtle fallback: GET `Accept: application/ld+json` (overridable); `dataset()` content-type aware (`application/ld+json` → `parseJsonld`, `text/turtle` → `parseTurtle`, else throw); `PUT { dataset }` → `JSON.stringify(await jsonld.fromRDF(dataset))` + `application/ld+json`. (Fixed regex bug: `+` in `application/ld+json` — use `includes`, not `match`.)
2. **`setAcr`** (`crud/agent-registration.ts`) → `fetch.raw` + `serializeTurtle(dataset)` body + `Content-Type: text/turtle` (ACR stays Turtle; required once the wrapper serializes JSON-LD).
3. **`data.json`** → JSON-LD expanded form (mechanical per-entry conversion: `parseTurtle(text, key)` → N3 Store → `jsonld.fromRDF` → `JSON.stringify`). **98 converted; 10 kept raw** (don't parse as Turtle, all unused by package tests): already-JSON-LD `https://auth.alice.example/`, 3 ShEx shapes, 4 invalid-Turtle bob entries, 1 truncated, 1 empty. Keys unchanged.
4. **`fetch-mock.ts`** — JSON-LD-first: `json()` returns the stored doc verbatim (`JSON.parse`), PUT stores body verbatim (round-trips work), storage-description special case JSON-LD; Turtle only for explicit `Accept: text/turtle`. Dropped `turtleToJsonLd`.
5. **Rewrote** `packages/utils/test/fetch.test.ts` + `packages/test-utils/test/fetch-mock.test.ts`.

### Gate after this session

- utils 40 pass; test-utils 10 pass; data-model **193 pass / 10 skip / 10 todo — unchanged**; application 7 pass / 13 skip (unchanged); authorization-agent all skip-gated (gate = typecheck/build ✓)
- `tsc -b` clean for utils, test-utils, data-model, application, authorization-agent, components; `turbo run build` 9/9; `turbo run test` 14/14

## Next — convert CRUD domain modules to POJO GET/PUT (start: `role.ts`)

> Detailed steps, role cluster, and the other-types inventory live in [`refactor-data-model-followup.md`](refactor-data-model-followup.md).

Per module: add a JSON-LD context (registry style — `@type: '@id'` + `@container: '@set'` for arrays), `fromJsonLd(doc, iri)` via `frameDoc`, `toJsonLd(data)` via `withContext`; `loadX` = raw JSON-LD GET + `fromJsonLd`; `putX` = raw JSON-LD PUT. Drop `CRUDResource` + timestamp machinery where fixtures carry no timestamps (roles don't — confirmed in `registry.trig`). Modules: `role.ts` (first) → `agent-registration.ts`, `application-registration.ts`, `social-agent-registration.ts`, `social-agent-invitation.ts`, `registry-set.ts`; registry listing modules can stay on `linkedIris` until each converts.

## Stays Turtle by definition (the "fully JSON-LD" boundary)

- **SPARQL patches** — `insertPatch`/`deletePatch` (`CRUDContainer.add/remove/replaceStatement`, `create`, `DataInstance` blob PATCH): SPARQL Update protocol bodies are quad Turtle serializations; JSON-LD-in-SPARQL is not standard.
- **ACL/ACR resources** — `setAcr`, `templates/*.acr.ts` (WAC/ACP).
- **shex shapes** — not RDF (`solid/shapes/*.shex`, FHIR `CarePlan-shapes`).
- **(optional)** `application/src/notification-manager.ts` (`parseTurtle` on inbox notifications) — server-dependent payloads; can stay Turtle.

## Remaining open items

- **`authorization-agent/src/authorization.ts`** write — works either way now (wrapper PUT `dataset` → JSON-LD). Optional symmetry: `toJsonLd` + raw PUT (like grants). Pending user decision.
- **Order caveat (learned in Phase 3):** JSON-LD roundtrips do not preserve quad *order* — order-sensitive expectations (`descriptionLanguages`, `reliableDescriptionLanguages`) must compare sorted / order-independently.

---
# Phase 6 — Test infrastructure consolidation → moved to [`test-infra-consolidation.md`](test-infra-consolidation.md)
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

> Status: **complete** — executed via [`docs/plans/test-infra-consolidation.md`](test-infra-consolidation.md) (steps 1–3 landed; the client-id quadstore move + S3-seeding drop were dropped by decision — the file-backed client id stays).

| Package | Files / status |
|---------|-------|
| `packages/css-storage-fixture` | `test/registry.trig` unchanged (client id **stays S3-seeded** — no client-id content graph added); shapetrees trees/descriptions already in the trig; `test/data/`, `dev/data`, `.internal/` **kept** (client id + dev fixture stay) |
| `test/` (root) | `test/discovery.test.ts` (ported from `packages/utils`, mock-free); `setup.ts` **keeps** the S3 client-id seeding (`garage.putAnyObject`/`deleteObject`); application server blocks dropped (not moved); repl `cli` deleted |
| `packages/application` / `packages/utils` / `packages/repl` | application: `describe.skip` server block dropped, mock-based describes kept; utils: discovery suite moved to root; repl: `cli.ts`/`repl.ts`/`cli.test.ts` deleted (keeps `cmd.ts`/`add-user.ts`) |
| `packages/css-test-utils` | **deleted** (package + `localhost:3711` realm + `test/.internal/`), devDeps dropped from `application`/`utils`; remaining `.shex` files only in the out-of-scope root `shapetrees/` demo + `dev/pod/` fixture |
| `docker-compose.yaml` | `data` service **kept** (client id remains file-backed via garage S3) |

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
