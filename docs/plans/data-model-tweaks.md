# Data-model tweaks

> **Status:** ✅ done — executed via commit `7aaf586f [data model] tweaks`. Milestones M1–M4 landed; all packages green (`data-model` 75, `authorization-agent` 73, `components` 35 vitest). The dagger suite passed with a fresh cache volume (the earlier `admin-events` failure was stale-image cache). Deferred item (Q5, Draft swap + `hasInheritingGrant` cleanup) remains future work — see §Decisions.
>
> **Execution constraints (AGENTS.md):** agent does not `git add`/`commit` (user stages/commits); agent may run vitest inside `/packages` (data-model, authorization-agent, components); the repo `/test` (dagger) is user-run.
>
> **Scope:** post-`d72f5121` cleanup of `packages/data-model`. Established pattern (from `refactor-data-model-followup.md`): per-model POJO types + `fromJsonLd(doc, id)` via `frameDoc` + `loadX(id, fetch)` via `fetchJsonLd`; no `DataFactory`/N3/quad machinery in the read surface where avoidable. `data-instance.ts` is explicitly **out of scope** (leave as-is).

## Survey findings

### 1. `shape-tree.ts` — the only model still built on RDF datasets

| Function | Kind | Consumers |
|---|---|---|
| `fromDataset(dataset, id)` | quad-based read | **tests only** (`test/framing/shape-tree.test.ts:54`); no production callers. Declared `async` but body has **no `await`** (sync-able) |
| `fromJsonLd(doc, id)` | `parseJsonld` → `fromDataset` (no `frameDoc`, unlike every other model) | internal + tests |
| `loadShapeTree(id, fetch)` | **hand-rolled `fetch`** (no `fetchJsonLd`, and unlike `fetchJsonLd` it does **not** check `response.ok`) | authorization-agent, components |
| `toDataset(data)` | `toStore(toJsonLd(data))` | **no production callers** (tests only) |
| `toJsonLd(data)` | `withContext` | **no production callers** — test-only (round-trip fixture at `test/framing/shape-tree.test.ts:53`); survives only as the test's write side (see §Decisions, Q2) |
| `getDescription(tree, lang, fetch)` | hand-rolled `fetch` + `parseJsonld` + quad scan (`usesLanguage`/`describes`/`inDescriptionSet`) | authorization-agent `data-instance.ts:26`, components `Authorization.ts`/`DataRegistry.ts`/`ShareResource.ts` — **behavior function, keep** |
| `expectsType(tree)` | sync accessor | **zero callers — not even tests** → mark for removal (see §Decisions, Q6) |

Why quads were needed (framing gaps):
1. `references` — blank-node objects (`sh:references` → blank nodes with `hasShapeTree`/`viaPredicate`). `buildFrame` applies `@embed: '@never'` to every object-valued term, so framed output yields `{'@id': '_:…'}` — unstable blank-node ids that break content round-trip.
2. `descriptionLanguages` — `sh:usesLanguage` typed literals live on description-**set** nodes, reachable from the tree only via `sh:describes` (a foreign node). A node-centric frame of the tree never sees them unless `describes` is embedded too.
3. `getDescription` needs the same document-level scan (foreign-node properties).

**Two designs (both spike-verified; B′ chosen — see §Decisions §1):**

Both designs verified in a spike against the real fixture (`environments/data/registry.trig`, graph `shapetrees:Project` — `references` are named `uuid:` IRIs, `usesLanguage` sits on `desc-#Project`/`desc-*` nodes chained to the tree via `describes` × `inDescriptionSet`):

- **A — full framing:** one custom `jsonld.frame` call for the tree node with property templates `references: { hasShapeTree: {}, viaPredicate: {} }` (frame templates **embed node content automatically** — no `@embed` needed) and a reverse term `describedBy: { '@reverse': describes, '@container': '@set' }` chained to `inDescriptionSet: { usesLanguage: {} }`. Spike results: references come back as content objects (`{ id?, hasShapeTree, viaPredicate }` — `id` is a stable `urn:uuid:` on real docs, absent on blank-node write docs); `describedBy[].inDescriptionSet.usesLanguage` returns the languages as typed-literal value objects (`{ '@value': 'en', type: xsd:language }`) that the mapper unwraps. Caveats: bypasses `frameDoc`/`buildFrame` (which forces `@embed: '@never'` — spike confirms that yields id-only refs, the reason quads were used); needs a local frame constant + `jsonld.frame(doc, frame, { documentLoader })` (`jsonld` is already a direct data-model dep, `documentLoader` is exported by interop-utils); must read languages from **two shapes** — the real document (describedBy chain) and the current `toJsonLd` write shape (tree-node `usesLanguage`).
- **B′ — frame + expanded-doc walk (recommended):** `frameDoc(doc, dataModelContext, id)` for the node-level scalars (`shape`, `describesInstance`, `expectsType`, `type`) — exactly like every other model — plus two small private extractions on the **already-expanded JSON-LD** (no N3, no `parseJsonld`): `await documentValues(doc, id, SHAPETREES.usesLanguage)` for the languages (the same helper `access-need.ts:60` already uses for the identical `usesLanguage` problem) and a ~10-line walk pairing each tree-node `references` entry to its `hasShapeTree`/`viaPredicate`. Public surface matches the package pattern (`fromJsonLd` + `fetchJsonLd`-based `loadShapeTree`); no custom frame; both helper mechanisms already shipped and tested in interop-utils.

Either way: `loadShapeTree` → `fromJsonLd(await fetchJsonLd(id, fetch), id)`; `getDescription` GET → `fetchJsonLd` (same document extraction; can reuse the B′ walk or a small frame in A); `fromDataset`/`toDataset` deleted, round-trip test rewritten to `fromJsonLd(toJsonLd(tree))` (content-based references make the round-trip stable — spike arm 3 confirms blank-node refs read back as content objects).

### 1b. Test-only / dead exports — complete audit

Every export whose only usage is in `packages/data-model/test` (or has no usage at all):

| Export | Found usage | Verdict |
|---|---|---|
| `ShapeTree.fromDataset` (`shape-tree.ts:56`) | `test/framing/shape-tree.test.ts:54` only | **delete** (B′ chosen; round-trip test rewritten to `fromJsonLd(toJsonLd(tree))`) |
| `ShapeTree.toDataset` (`shape-tree.ts:101`) | **zero callers** — not even tests (test uses `toStore(ShapeTree.toJsonLd(...))` directly) | **delete** (dead code) |
| `ShapeTree.toJsonLd` (`shape-tree.ts:106`) | `test/framing/shape-tree.test.ts:53` only | test-only — keep only as the round-trip write side, or fold into the test; **not a production API** |
| `ShapeTree.expectsType` (`shape-tree.ts:163`) | **zero callers** (the `expectsType` hits in tests are the data *property*, not this function) | **delete** |
| `AccessDescription.accessNeedDescriptionFromJsonLd` / `accessNeedGroupDescriptionFromJsonLd` | `test/framing/access-description.test.ts` only | rename/split to `fromJsonLd` (M1) |
| `iriTermDef` (`context.ts:27`) | used **internally** in `context.ts` only; zero external consumers (not even tests) | keep as **module-internal** helper — stop re-exporting from `index.ts` |
| `AccessDescriptionSetData` (`access-description-set.ts:12`) | **zero consumers** — not even tests; authorization-agent has its own `access-description-set.ts` and does not import the type | **delete** the type (module has no other use) |
| `DataModelDependencies` (`index.ts:11`) | zero use inside data-model | move to authorization-agent (§2) |

Everything else in the audit came back **production-used**: `dataModelContext`, `getDescription`, `isBlob`, `frameDataInstance(FromDoc)`, `labelFromNode`, `childIris`, `ActivityData`, `AgentAndClient`, `webIdTemplate`/`dataGrantTemplate` etc. (templates), `loadRegistrySet`/`RegistrySetData`, `loadWebIdProfile`, `loadClientIdDocument`, `getDataGrantIris`/`getAdminGrantIris`, `toDataset` (social-agent-registration), `toJsonLd` (grant / data-authorization / admin-authorization — used by components + authorization-agent), `dataRegistryIri`.

### 2. `DataModelDependencies` — move to authorization-agent

- Defined at `packages/data-model/src/index.ts:11`; **nothing inside data-model uses it** (the `iriForContained` mention in its doc comment is stale — the symbol no longer exists in `src/`).
- All consumers are in `packages/authorization-agent`: `agent-registry.ts`, `activity-registry.ts`, `authorization.ts`, `grant-generation.ts`, `role-registry.ts` (used as `deps: DataModelDependencies`, feeding `deps.fetch` / `deps.randomUUID`).
- **Move** the interface to authorization-agent (e.g. `src/types.ts` or `src/index.ts`), update the 5 import sites. (`AgentAndClient` from data-model templates stays put — it travels with `deps` as a separate type.)

### 3. `toDataset` consumers

| Definition | Consumers |
|---|---|
| `agent-registration.ts:23` `toDataset` | only data-model's own `social-agent-registration.ts` (`registrationToDataset` import, line 9/80) → can become a non-exported internal helper of a shared write module, or stay module-internal |
| `social-agent-registration.ts:79` `toDataset` | authorization-agent `createSocialAgentRegistration` (`src/social-agent-registration.ts:37`, container.create path) — **keep exported** |
| `shape-tree.ts:101` `toDataset` | no production callers (tests only) → delete/keep-per-tests (see shape-tree section) |
| `application-registration.ts` | **has no `toDataset`** — authorization-agent writes it directly (`createApplicationRegistration`, `withContext` + `toStore`). Read-only model in data-model; nothing to do |

### 4. Message guards (`access-request.ts`, `access-revocation.ts`)

- `isAccessRequestMessage` / `isAccessRevocationMessage` consumers: **only** `packages/components/src/GrantIssuanceHandler.ts:60,67` (plus data-model test `test/pojo/messages.test.ts`).
- Message **types** also consumed by components: `AccessRequestMessage`/`IncomingGrantData` (GrantIssuanceHandler, temporal `activities/grants.ts:9,18,359`), `AccessRevocationMessage` (GrantRevocationHandler).
- `IncomingGrantData` extends `GrantData` (stays in data-model).
- **Decision (Q4): keep the message types in data-model**; move **only the two guard functions** to components (new `src/messages.ts`). `access-request.ts` / `access-revocation.ts` keep their interfaces; `test/pojo/messages.test.ts` guard assertions move to components.

### 5. `access-description.ts` — naming alignment

- Two models share one file: `accessNeedDescriptionFromJsonLd` / `accessNeedGroupDescriptionFromJsonLd` — the only `fromJsonLd`-named functions that don't follow the `fromJsonLd(doc, id)` convention (they can't both be `fromJsonLd` in one module).
- Consumers of the `fromJsonLd` variants: **tests only** (`test/framing/access-description.test.ts`); the `loadAccessNeedDescription` / `loadAccessNeedGroupDescription` loaders are used by authorization-agent (`src/access-description-set.ts:88,90`) — names stay.
- **Proposal:** split into `access-need-description.ts` and `access-need-group-description.ts`, each exporting `fromJsonLd` + its loader; shared `AccessDescriptionId`/`AccessDescriptionData` base types stay in `access-description.ts`; index re-exports types + `* as AccessNeedDescription` / `* as AccessNeedGroupDescription` (drop the `AccessDescription` namespace).

### 6. `registry-set.ts` — adopt `fromJsonLd`

- Only loader without a `fromJsonLd` split-out: framing is inlined in `loadRegistrySet` (`registry-set.ts:31`).
- **Proposal:** extract `export async function fromJsonLd(doc, id)`; `loadRegistrySet = fromJsonLd(await fetchJsonLd(id, fetch), id)`.

### 7. Async functions that don't need to be

| Function | Body | Call sites that drop `await` |
|---|---|---|
| `getDataGrantIris` (`agent-registration.ts:47`) | `return data.hasDataGrant ?? []` | authorization-agent `agent-registration.ts:79,94`, `authorization-agent.ts:557`; components `grants.ts:181`, `AgentRegistry.ts:124,146` (+ tests `agent-registration.test.ts`, `social-agent-registration.test.ts:56`) |
| `getAdminGrantIris` (`social-agent-registration.ts:103`) | `return data.hasAdminGrant ?? []` | authorization-agent `social-agent-registration.ts:83`; components `adminGate.ts:53`, `AgentRegistry.ts:108,110`, `Context.ts:44`, `AgentIdHandler.ts:75` (+ tests `social-agent-registration.test.ts:86`) |
| `toDataset` (`agent-registration.ts:23`, `social-agent-registration.ts:79`) | pure N3 `Store` building (sync) | authorization-agent `createSocialAgentRegistration` (`social-agent-registration.ts:37`, `await toDataset(data)`) |
| `shape-tree.ts` `fromDataset` | declared `async`, no `await` | moot if removed in the shape-tree pass |
| `shape-tree.ts` `toDataset` | `await toStore(...)` — **stays async** | — |

### 8. `GrantData` / `DataAuthorizationData` — the only optional-id models (Draft idea)

- Confirmed: **only** `grant.ts` (`GrantId.id?`) and `data-authorization.ts` (`DataAuthorizationId.id?`) have optional `id` + `Final*` variants (`FinalGrantData`, `FinalDataAuthorizationData`). Every other model requires `id: string`.
- Producers of id-less ("draft") values:
  - authorization-agent `authorization.ts:116` (`saiReady: DataAuthorizationData`, no id) → `generateFinalDataAuthorizations` (:176) assigns IRIs → `FinalDataAuthorizationData[]`
  - authorization-agent `grant-generation.ts:133` (`childData`, commented "no id — delegation endpoint assigns IRIs"), `:222` (`grant`)
  - components `grants.ts:180` (transferGrant builds `GrantData[]`, then `storeDataGrant(payload: FinalGrantData)` PUTs them)
- **Decision (Q5): deferred — grants stay exactly as they are for now.** No Draft swap, no `hasInheritingGrant` cleanup, `Final*` types remain. Recorded as future work in the decisions section.
- Related note (unchanged by the decision): `IncomingGrantData` (`access-request.ts`) is built via `Omit<GrantData, 'hasInheritingGrant'>`, and there is an existing smell `grant.hasInheritingGrant = childGrantData as unknown as string[]` (`grant-generation.ts:243`) — embedded child grant **objects** typed as `string[]`. Both stay untouched.

## Implementation & review milestones (4 checkpoints — review after each)

The 8 proposed changes are grouped into **4 milestones**. Each milestone is self-contained, ends green (vitest in the packages it touches — agent can run `/packages` suites; the `/test` dagger suite stays user-run as the final gate), and is reviewed before the next starts. No git staging/commits by the agent (AGENTS.md).

**M1 — data-model read-path alignment · *data-model only, zero behavior change***
- `registry-set.ts`: extract `fromJsonLd(doc, id)`; `loadRegistrySet = fromJsonLd(await fetchJsonLd(id, fetch), id)` [was 1]
- access-description split → `access-need-description.ts` / `access-need-group-description.ts` (each exports `fromJsonLd` + its loader; shared base types stay in `access-description.ts`; index re-exports types + `* as AccessNeedDescription` / `* as AccessNeedGroupDescription`) [was 2]
- dead cleanup (minus `expectsType`, which goes in M2): stop re-exporting `iriTermDef` (module-internal); delete `AccessDescriptionSetData` + the now-empty `access-description-set.ts`; drop the index export line [was 8]
- Tests: `framing/access-description.test.ts`, `framing/registry-set.test.ts`

**M2 — shape-tree pass (design B′) · *data-model only, riskiest***
- `fromJsonLd` = `frameDoc` for scalars + `documentValues(doc, id, SHAPETREES.usesLanguage)` for `descriptionLanguages` + small expanded-doc walk pairing `references` → `hasShapeTree`/`viaPredicate` (mirrors `access-need.ts`) [was 6]
- `loadShapeTree` → `fromJsonLd(await fetchJsonLd(id, fetch), id)`; `getDescription` GET switches to `fetchJsonLd` (same document extraction)
- delete `toDataset` (zero callers), `fromDataset` (test-only), `expectsType` (zero callers); keep `toJsonLd` as the test write side [was 6 + 8's expectsType]
- Tests: `framing/shape-tree.test.ts` round-trip rewritten to `fromJsonLd(toJsonLd(tree))`; `readable/shape-tree.test.ts` (getDescription)

**M3 — cross-package signature cleanup · *data-model + authorization-agent + components***
- sync-ify: `getDataGrantIris`, `getAdminGrantIris`, `toDataset` (agent-registration + social-agent-registration) return sync values; drop `await` at the ~13 call sites in authorization-agent (`agent-registration.ts:79,94`, `authorization-agent.ts:557`, `social-agent-registration.ts:37,83`) and components (`grants.ts:181`, `AgentRegistry.ts:108,110,124,146`, `adminGate.ts:53`, `Context.ts:44`, `AgentIdHandler.ts:75`) + their tests [was 3]
- `DataModelDependencies` interface → authorization-agent (e.g. `src/types.ts` or `index.ts`), retarget the 5 imports; `AgentAndClient` stays in data-model (Q7) [was 4]
- Tests: affected authorization-agent + components unit tests

**M4 — message guards relocation · *data-model + components***
- move `isAccessRequestMessage`/`isAccessRevocationMessage` (**only the guards**) to new `components/src/messages.ts`; message types (`AccessRequestMessage`, `IncomingGrantData`, `AccessRevocationMessage`) stay in data-model; retarget `GrantIssuanceHandler` imports; move/drop the guard assertions from `test/pojo/messages.test.ts` [was 5]
- Tests: components (GrantIssuanceHandler behavior) + remaining data-model message-type usage

Deferred (Q5, NOT in any milestone): Draft swap, `hasInheritingGrant` cleanup — grants stay exactly as they are.

## Decisions (recorded)

Answered by review pass — decisions applied to the survey and the milestones (M1–M4) below:

1. **Shape-tree design A vs B′** — ✅ **decided: B′ (frame + expanded-doc walk).** Both were spike-verified (§1). B′ = `frameDoc` for scalars + `documentValues(doc, id, SHAPETREES.usesLanguage)` for languages + a small expanded-doc walk pairing `references` entries to `hasShapeTree`/`viaPredicate`; `loadShapeTree`/`getDescription` use `fetchJsonLd`; `toDataset`/`fromDataset`/`expectsType` deleted, `toJsonLd` kept as test write side. **Future-A note (do NOT do now):** if design A (custom reverse-embed frame) is ever pursued, its scope should be **shape-tree + `access-need.ts` together** — access-need is the only other model collecting foreign-node data (`descriptionLanguages` via `documentValues` at `access-need.ts:60`, same `usesLanguage`-on-description-sets problem; its chain is need ← reverse `hasAccessNeed` → `hasAccessDescriptionSet` → `usesLanguage`, the analogue of shape-tree's `describes`/`inDescriptionSet`). A on both would remove `documentValues` from data-model reads entirely. Under B′, shape-tree's `fromJsonLd` deliberately mirrors `access-need.ts` (frameDoc + documentValues), so the two stay pattern-identical either way.
2. **`toDataset`/`fromDataset`/`toJsonLd` (shape-tree)** — checked `test/util.ts` and package unit tests: `test/util.ts` imports only *types* (`ActivityData`, `GrantData`, `SocialAgentRegistrationData`); `ShapeTree.toJsonLd`/`fromDataset` appear **only** in `packages/data-model/test/framing/shape-tree.test.ts:53-54`; `ShapeTree.toDataset` has **zero callers, tests included**. ✅ decided: delete `toDataset` + `fromDataset`, keep `toJsonLd` (round-trip test writes via `toJsonLd`, reads via `fromJsonLd`).
3. **`getDescription` (shape-tree)** — ✅ in scope: switch its GET to `fetchJsonLd`.
4. **Guards move** — ✅ keep message types in data-model; move only the two guard functions to components.
5. **Draft swap** — ✅ deferred: grants/data-authorizations stay exactly as they are (future work).
6. **Zero-consumer deletions** — ✅ delete all: `expectsType()`, `AccessDescriptionSetData` (+ empty `access-description-set.ts`), un-export `iriTermDef`.
7. **`AgentAndClient`** — ✅ stays in data-model; only `DataModelDependencies` moves.
8. **`application-registration`** — ✅ confirmed against `docs/plans/remove-turtle-serialization.md` (Phase 1c): the intended write shape is `withContext(dataModelContext, data)` → `createContainer` directly (drop the intermediate `toStore`), owned by the **turtle plan** in authorization-agent's `createApplicationRegistration`; read-only in data-model is the intended end state.