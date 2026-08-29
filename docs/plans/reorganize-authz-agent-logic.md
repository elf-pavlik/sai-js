# Reorganize sai-js boundaries — data-model sheds logic to `application`, `authorization-agent`, and components adapters

> **Status:** 🔶 partial — **Phases 1 and 2 are done and verified** (full
> build + package vitest + the `/test` integration suite all green after Phase
> 1; Phase 2 verified by package suites — `/test` re-run pending); Phases 3–4
> are design only. Four behavior-preserving phases, each
> gated by **full build + all package tests + the `/test` integration suite**:
> **Phase 1** removes the factories (and folds in the `iri` → `id` parameter
> rename); **Phase 2** extracts application-specific logic from data-model;
> **Phase 3** extracts authorization-specific logic from data-model into AA
> session methods; **Phase 4** moves SAI domain/spec logic from components into
> AA, leaving components with CSS handlers, internal storage, the RPC API,
> webhooks, notifications, and workflow glue.
>
> Goal: data-model becomes **mostly POJOs + framing + generic CRUD primitives**;
> application and authorization-agent each own their domain logic and depend on
> data-model; components keeps server concerns and thin RPC adapters.
>
> Decisions (confirmed with the plan owner): one plan, 4 phases as above; the
> AA exposes moved logic as **session methods**; `ResolvedContext` seam kept;
> no `api-messages` dependency in the AA; `iri: string` parameters become
> `id: string`, fold into Phase 1 and carry the convention into Phases 2–4.

## 1. Problem

- The factories (`ApplicationFactory`, `AuthorizationAgentFactory`) act as a
  *deps bundle* threaded through ~100 data-model function signatures
  (`factory: AuthorizationAgentFactory` — mostly for `.fetch`), plus hold
  create-paths (`{ ...data, id: iri }`) and one inline-fetch loader with no
  `loadX` twin (`shapeTree`).
- SAI domain/spec logic is scattered: the grant-generation chain in
  data-model (leaf, can't import the AA plane), services/domain rules in
  components mixed with RPC mapping, match semantics in Temporal activities.
- Parameter naming is inconsistent (`iri: string` vs `id: string`).
- Components is today the largest direct consumer of data-model *behavior*
  modules (ActivityRegistry outbox, AgentRegistry/RoleRegistry/
  AuthorizationRegistry, reciprocal/social-agent ops, Grant + data-instance
  helpers, description modules, AccessRequest/Revocation parsing, templates,
  `GrantRegistry.iriForContained`) — none of which is its concern.

## 2. Target architecture

```
api-messages (schemas + RPC router — unchanged)
   ▲
   │  components: ApiHandler (unchanged) → services/*.ts adapters
   │    • resolveContext, transport selection (queries/org.ts)       — stays
   │    • RPC schema ↔ AA structure / data-model POJO mapping         — thin
   │    • CSS handlers, storage, RPC API, webhooks, notifications,
   │      admin gate, proxy/mirror, Temporal workflows, policy engine — stays
   ▼
authorization-agent  ← ALL SAI domain/spec logic (session methods, POJO in/out)
        │
        ├── application  ← app-agent logic (grants reads, instance enumeration)
        ▼
data-model (POJO types + framing loaders + generic CRUD primitives)
```

**Boundary rules**

- data-model keeps: POJO types, framing (`fromJsonLd`/`loadX`/`toX`),
  `data-instance` framing (`loadDataInstance`, `computeChildren`, `childIris`,
  …), `shape-tree` framing (`loadShapeTree` + description resolution),
  access-need/group framing + descriptions, generic registry/container CRUD
  primitives (over `{ fetch, randomUUID }`), `context`, templates, the
  Activity-Registry outbox (event infra, not SAI rules).
- application owns: app-side grant reads (`ApplicationRegistration.getDataGrants`),
  `Grant.iriForNew`, instance enumeration — everything only the app agent needs.
- authorization-agent owns: every SAI rule — grant generation, scope matching,
  delegation matching, authorization structure rules, admin marker,
  AdminAuthorization, reciprocal federation, registration-projection cleanup,
  registry-plane reads (session methods, POJO in/out).
- components owns: server concerns (listed above) + thin conversion between
  `api-messages` and AA structures / data-model POJOs.
- `ApiHandler`, the RPC router, every `api-messages` schema: untouched.
- The AA imports no `api-messages`; data-model stays the leaf.

## 3. Current shape (as-is)

All line numbers current at the time of writing.

### 3.1 Factory surface (`application-factory.ts`, `authorization-agent-factory.ts`)

| Bucket | Methods |
|---|---|
| Real logic | `ApplicationFactory.dataInstance` (registration→shapeTree→blob→frame→children), `shapeTree` (inline fetch+parse — no `loadX` twin), `AAFactory.applicationRegistration` data-path (`granted`/`type`), `accessNeed`/`accessNeedGroup` (recursion) |
| Thin `loadFoo` delegates | `applicationRegistration`, `dataRegistration`, `shapeTreeDescription`, `webIdProfile`, `clientIdDocument`, `dataGrant`, `socialAgentRegistration`, `socialAgentInvitation`, `role`, `dataAuthorization`, `accessNeedDescription`, `accessNeedGroupDescription`, `registrySet` |
| Pure identity `{ id: iri }` | `roleRegistry`, `dataRegistry`, `authorizationRegistry`, `grantRegistry`, `agentRegistry`, `accessDescriptionSet` — **zero callers** |
| Trivial create-paths (`{ ...data, id: iri }`) | `socialAgentRegistration`, `socialAgentInvitation`, `role`, `dataRegistration`, `dataGrant` — only 4 live callers, all data-model crud writers (`agent-registry.ts:128,159,193`, `data-registry.ts:70`); `role`/`dataGrant` create-paths dead |

The `factory` parameter appears in ~100 data-model function signatures (incl.
composed helpers `computeChildren`, `getDataInstanceIterator`, `ShapeTree.getDescription`,
access-need/group modules, registry-set) — almost always just for `.fetch`.

### 3.2 Deliberate consumers

- `application`: `ApplicationFactory` (`applicationRegistration`, `dataRegistration`,
  `dataGrant` via `ApplicationRegistration.getDataGrants`, `randomUUID`).
- AA: `webIdProfile`, `registrySet`, `dataAuthorization`, `dataInstance`, `fetch`
  (+ at runtime via data-model internals: `role`, `dataGrant`, `dataRegistration`,
  `socialAgentRegistration`, `applicationRegistration`, `socialAgentInvitation`).
- components: `ctx.session.factory.*` (shapeTree×6, clientIdDocument×4, role×3,
  dataInstance×3, dataRegistration×2, dataGrant×2, accessNeedGroup×2, …) and its
  own `new ApplicationFactory` in `SaiPermissionsEngine` (only `shapeTree.references`).

### 3.3 Grant-generation path (Phase 3 input)

All in `packages/data-model/src/data-authorization.ts`; sole caller of the
exported entry is AA's `generateDataGrants` (`authorization-agent.ts:266`).
`generateGrantsForAuthorization` (:466), `generateDataGrants` (:399),
`generateSourceDataGrants` (:314), `generateDelegatedDataGrants` (:186),
`generateChildDelegatedGrantData` (:144), `generateChildSourceGrantData` (:276),
`inheritingAuthorizations` (:136). HTTP listing targets:
`DataRegistry.registrations`/`hasDataRegistration` (`crud/data-registry.ts:38,31`),
`AgentRegistry.socialAgentRegistrations` (`crud/agent-registry.ts:50`),
`agent-registration.getDataGrants` (:88); `registeredShapeTrees` (:48) has zero
consumers. Shared primitives that stay: `storageIri` (components
`services/DataRegistry.ts:50`), `GrantRegistry.iriForContained`
(`GrantIssuanceHandler`, admin workflows), `getDataGrantIris` (components).

Registry-plane reads already in AA (`authorization-agent/src/sparql.ts`):
`localSparqlTransport`, `listContained` (reads `ldp:contains` +
`hasSocialAgentRegistration`), `getSocialAgentRegistration`, `listDataRegistrations`,
`getDataRegistration` (returns `contains`), `getDataGrant`, `getDataAuthorization`,
`getRole`.

### 3.4 Domain logic in components (Phase 4 input)

- services (`services/`): duplicate scope-match switch
  (`ShareResource.agentsWithAccessMatching` vs `AA.findAgentsWithAccess`),
  RPC→structure rules (`Authorization.buildDataAuthorizations`), admin-marker
  rule (`buildSocialAgentProfile`), registry-plane reads
  (`DataRegistry.dataGrantIndexForAgent`, `Authorization.findUserDataRegistrations`),
  `ShareAuthorization` → `ShareDataInstanceStructure` `as unknown as` cast,
  `removeGrantsFromRegistration` (`util/registrations.ts`).
- temporal activities (`temporal/activities/grants.ts`): `findAffectedGrantees`
  (:141, ports `findAuthorizationsDelegatingFromOwner`), `findRoleUsage` (:183),
  `typeGrantee` (:44), `getGrantees` (:229).
- handlers: delegation validation (`GrantIssuanceHandler.validateDelegable`),
  revocation authority+closure (`GrantRevocationHandler.revokeGrants` +
  `findGrants`/`findInheritingChildren`).

## 4. Plan — 4 phases, each gated

**Gate (after every phase):** `npm run build` per package; `vitest run` per
package; the `/test` integration suite (dagger, user-run) — all green. Each
phase must be behavior-preserving; the integration suite is the regression gate.

### Phase 1 — remove factories; normalize loaders; `iri` → `id` — ✅ done

> **Implementation notes (what actually landed):**
>
> - The deps seam is **`DataModelDependencies { fetch, randomUUID }`** (renamed
>   from `FactoryDependencies`): pure-read functions take `fetch: WhatwgFetch`;
>   writers that assign new resource IRIs (`iriForContained`) take the full
>   deps object. Consumers pass `{ fetch, randomUUID }` (AA session now exposes
>   both members; components use `ctx.session.fetch`/`session.randomUUID`).
> - `RegistrySetData` **lost its `factory` member** — `loadRegistrySet(id, fetch)`
>   builds registry POJOs with no deps attached; all `registrySet.factory.X`
>   call sites were converted.
> - The factory *logic* found new module-function homes (all framing, stays in
>   data-model): **`loadDataInstance`** on `data-instance.ts`, **`accessNeed` /
>   `accessNeedGroup`** (recursive children/needs resolution), and a new
>   **`loadShapeTree`** loader (`SaiPermissionsEngine` de-factored via it).
>   `ShapeTree.getDescription`/`computeChildren`/`frameDataInstance` take `fetch`.
> - The 4 live create-paths were inlined into the crud writers; the dead
>   `role`/`dataGrant` create-paths dropped; `iriForContained` now takes
>   `randomUUID`.
> - `iri: string` → `id: string` folded in on **all data-model function
>   parameters** (69 sites) — and, for consistency, the `ChildInfo.shapeTree`
>   field (`iri` → `id`, touching components + tests). Deliberately left:
>   `DataOwnerData.iri` (a POJO field, not a parameter) — decide alignment in
>   Phase 2.
> - **`/test` helpers were in scope**: `test/util.ts` + 8 integration test
>   files used `session.factory.X`; migrated to `session.fetch` /
>   `loadSocialAgentRegistration` / `loadGrant` (the integration suite is the
>   real gate for this phase — an earlier run surfaced all 17 failures at once).
> - Verification: `tsc --noEmit` clean (data-model, application, AA,
>   components); vitest green (data-model 166, AA 5, application 7, components
>   30); rollup builds green; `/test` integration green.
> - Gate note: `biome check` is **not** part of the gate — the repo baseline
>   has ~208 pre-existing diagnostics; only the files changed by a phase are
>   expected to be biome-clean.

The deviations from the original bullet list are captured in the notes above; as planned, all of the following landed:

- Replace the `factory: …` parameter with `{ fetch: WhatwgFetch,
  randomUUID(): string }` (usually just `fetch`) across data-model's ~100
  signatures and **all** consumers (application, AA, components, repl, tests).
- Add **`loadShapeTree(iri, fetch)`** to `shape-tree.ts` (moves
  `ApplicationFactory.shapeTree`'s fetch+parse body; the missing `loadX` twin);
  `ShapeTree.getDescription(tree, lang, factory)` → `(tree, lang, fetch)` via
  `loadShapeTreeDescription`. `SaiPermissionsEngine.findParentResource`
  switches from `new ApplicationFactory(...).shapeTree(...)` to
  `loadShapeTree(parentShapeTreeId, fetch)`.
- Move the instance assembly to **`loadDataInstance(iri, fetch, …)`** as a
  function on the `data-instance.ts` module (wrinkle 1): `computeChildren`
  becomes `(node, shapeTree, fetch, lang)`; `dataInstance`-style composition
  stays in data-model as framing.
- Inline the 4 live create-path call sites into plain POJO construction in
  the crud writers; drop the dead `role`/`dataGrant` create-paths.
- Delete `ApplicationFactory`/`AuthorizationAgentFactory` and their tests
  (`application-factory.test.ts`, `authorization-agent-factory.test.ts` →
  `loadX` tests); migrate the ~20 test files that construct factories.
- Fold in the rename: `iri: string` → `id: string` on all data-model function
  parameters (69 occurrences today); carry the convention into Phases 2–4.
  Optional: Biome rule enforcing it.
- Components' `ctx.session.factory.X` sites call `loadX(ctx.session.fetch, …)`
  until Phases 3–4 replace them with session methods.

### Phase 2 — extract application-specific logic from data-model — ✅ done

> **Implementation notes (what actually landed):**
>
> - New `packages/application/src/grant.ts` hosts the application-side grant
>   helpers: `iriForNew`, `ApplicationRegistration.getDataGrants` (as
>   `getDataGrants(registration, fetch)`), `getGranted`, and the duplicated
>   `getDataInstanceIterator` (with the Phase-4 SPARQL TODO). Exported from the
>   application package's `index.ts`.
> - `DataOwnerData.iri` → `DataOwnerData.id` completed the `id` convention —
>   every data-model parameter *and* POJO field now uses `id`.
> - `Grant.canCreate` deleted from data-model along with its three test
>   assertions (all-from-registry, selected-from-registry, inherited) — the
>   application's own `canCreate` method (access-mode check) is unrelated and
>   stays.
> - `Application.getDataOwnersAsync` uses `getGranted` as its early-return
>   guard (behavior-identical); `resources()` delegates to the app's
>   `getDataInstanceIterator` after the same `Inherited → throw` guard it had
>   inline (behavior-identical) — the app copy is used, not dead.
> - data-model's `Grant.getDataInstanceIterator` stays (components'
>   `services/DataRegistry` still consumes it) with the Phase-4 TODO;
>   `dataRegistryIri`/`toJsonLd`/`loadGrant`/framing stay.
> - Verification: tsc clean (data-model, application); vitest green (data-model
>   162, application 7, authorization-agent 5, components 30); application +
>   data-model rollup builds green; biome clean on touched files.
> - Gate note: `/test` integration re-run pending (user-side, per AGENTS.md) —
>   the touched surface is application-only (no components/AA changes), so no
>   integration impact is expected.

As planned, with these deviations:

- Move to `application`: `Grant.iriForNew`, `ApplicationRegistration.getDataGrants`
  and `getGranted` (application-only consumers). Delete the dead
  `Grant.canCreate`.
- **`iri` → `id` alignment of the last POJO field**: rename `DataOwnerData.iri`
  → `DataOwnerData.id` (the only non-`id` field left after Phase 1; consumers
  are `application.ts` `getDataOwnersAsync`/`resourceOwners()`/`resourceServers()`
  + the application test). With this, the `id` convention covers every
  data-model function parameter and POJO field.
- `Grant.getDataInstanceIterator` (**wrinkle 2**): duplicate into
  `application`; keep the data-model copy (components still uses it) with a
  TODO: Phase 4 may replace components' usage with an AA SPARQL-backed
  enumeration (`getDataRegistration` returns `contains` for AllFromRegistry;
  `grant.hasDataInstance` for SelectedFromRegistry; Inherited still needs
  data-plane child walks via the data-instance framing helpers).
- data-model loses no shared primitive (framing/storageIri/iriForContained stay).

### Phase 3 — extract authorization-specific logic from data-model → AA session methods

- **Grant-generation chain** → AA behind the existing `generateDataGrants`
  session method (`authorization-agent.ts:266`): `generateGrantsForAuthorization`,
  `generateDataGrants`, `generateSourceDataGrants`, `generateDelegatedDataGrants`,
  `generateChildDelegatedGrantData`, `generateChildSourceGrantData`,
  `inheritingAuthorizations`. Listings use the AA plane
  (`listDataRegistrations`/`getDataRegistration`; `listContained`/
  `getSocialAgentRegistration` — `reciprocal.hasDataGrant` replaces
  `getDataGrantIris`, `getDataGrant` replaces `factory.dataGrant`; `getDataAuthorization`
  replaces `factory.dataAuthorization`; `AllFromRole` may use `findRole`/`getRole`).
  data-model keeps types, `GrantRegistry.iriForContained`, `DataRegistry.storageIri`,
  framing.
- **AdminAuthorization block** (`crud/authorization-registry.ts`:
  `adminAuthorizations`, `findAdminAuthorization`, `recordAdminAuthorization`,
  `deleteAdminAuthorization`, `AdminAuthorizationData`) → AA session methods
  (consumers: components admin RPCs/workflows switch to them).
- **Reciprocal-registration federation** (`crud/social-agent-registration.ts`:
  `discoverReciprocal`, `discoverAndUpdateReciprocal`, `updateReciprocal`) → AA
  session methods (consumers: ShareResource, AgentRegistry service, reciprocal
  workflows switch to them).
- **Orphan cleanup** in data-model: `DataRegistry.registrations`/
  `hasDataRegistration`/`registeredShapeTrees`, `AgentRegistry.socialAgentRegistrations`,
  `agent-registration.getDataGrants`. `DataAuthorization.fromJsonLd`/`load`/`toJsonLd`
  **stay** in data-model (framing pattern consistency; AA's `sparql.ts` keeps using them).

### Phase 4 — move SAI domain/spec logic from components → AA

Components keeps: CSS handlers + their HTTP layers, internal storage
(PostgresKV/S3/Hybrid accessors, stores), the RPC API (`ApiHandler`, router —
schemas/names untouched), webhooks (Activity/Reciprocal webhook stores + handlers),
notifications (push), admin gate (`adminGate`, `AdminSparqlHandler`,
`ProxyAdminHandler`), org-context transport (`queries/org.ts`), peer proxy /
reciprocal mirror, Temporal **workflow** orchestration, `SaiPermissionsEngine` as
a policy-engine integration (grant-matching rules may share AA predicates, but
the plugin stays a server concern).

Moves into AA session methods (POJO in/out):

- **services domain rules**: shared scope-match predicate (dedupes
  `agentsWithAccessMatching` vs `findAgentsWithAccess`); `buildDataAuthorizations`
  rules (scope→`INTEROP`, `dataOwner` assignment, one-level inheritance) +
  the "ensure Application Registration exists" step; admin-marker read;
  registry-plane reads (`dataGrantIndexForAgent`-style, registration/role
  listings); `removeGrantsFromRegistration`.
- **temporal match semantics**: `findAffectedGrantees`, `findRoleUsage`,
  `typeGrantee`/`getGrantees` (activities become thin wrappers).
- **delegation/revocation rules**: `validateDelegable` query and
  `findGrants`/`findInheritingChildren` join AA's `sparql.ts`; `revokeGrants`
  core (authority + inheriting-children closure) becomes a session method.
- **instance enumeration**: SPARQL-backed iterator over
  `getDataRegistration().contains` / `grant.hasDataInstance` resolves the
  wrinkle-2 duplicate TODO; Inherited arm uses data-instance framing.
- The two input-shape adaptations stay pure adapters: `api-messages
  Authorization` → AA `AuthorizationStructure` (field copies), `ShareAuthorization`
  → `ShareDataInstanceStructure` (field copies — kills the `as unknown as` cast
  and the AA's duplication TODO).

## 5. Decisions (confirmed)

- One plan, four phases as in §4; a full build + package tests + `/test`
  integration gate after **every** phase.
- AA exposes moved logic as session methods; `ResolvedContext` seam kept;
  adapters pass session/registrySet/webId.
- No `api-messages` dependency in the AA; `ApiHandler`/router/schemas untouched.
- `iri: string` → `id: string` folded into Phase 1; Phase 2 completed the
  convention with the `DataOwnerData.iri` → `id` field rename — every
  data-model function parameter and POJO field now uses `id`.
- Deps seam: **`DataModelDependencies { fetch, randomUUID }`** — pure reads take
  `fetch`; IRI-assigning writers take the full deps object; `iriForContained`
  takes `randomUUID`. `RegistrySetData` carries no deps/factory member.
- `loadShapeTree` added (Phase 1); instance assembly becomes `loadDataInstance`
  in `data-instance.ts`; `accessNeed`/`accessNeedGroup` compose functions added
  (the factory recursion); `getDataInstanceIterator` duplicated (app copy +
  data-model copy) with a Phase-4 SPARQL TODO.
- AdminAuthorization block + reciprocal federation: Phase 3; delegation/
  revocation rules: Phase 4 (nothing stays parked).
- data-model framing stays (pattern consistency); only rule orchestration moves.

## 6. Honest sizing

- **Phase 1 (done):** widest mechanically — 81 files, ~1280 insertions /
  ~1479 deletions: ~100 data-model signatures + every consumer (application,
  AA, components src + tests, `/test` integration helpers); zero behavior
  change; the `iri`→`id` rename rode along. Verified green end-to-end.
- **Phase 2 (done):** small — 11 files (~ -60/+120 lines): a new
  `application/src/grant.ts` (4 helpers incl. the duplicated iterator),
  `DataOwnerData` field rename, `Grant.canCreate` deletion, `resources()`/
  `getDataOwnersAsync` delegation + test updates. Thinnest gate: package suites
  green; `/test` re-run pending (application-only surface).
- **Phase 3:** ~300 lines moved (grant chain + admin + reciprocal) + orphan
  cleanup; the whole `/test` authorization/delegation machinery exercises it.
- **Phase 4:** largest regression surface — every `/test` service, org-context,
  grant/role workflow, and delegation/revocation flow exercises the moved code.

## 7. Verification (per phase)

- Phase 1: ✅ all package suites + `/test` integration (no behavior change — green).
- Phase 2: ✅ `packages/application` + data-model suites (application tests,
  instance/registration reads); `/test` integration re-run pending.
- Phase 3: `/test/authorization.test.ts`, `/test/services.test.ts` (source +
  delegated grants, role/delegation scopes), admin + reciprocal flows
  (`/test/org-context.test.ts`, admin workflows), data-model suites.
- Phase 4: `/test` services suites, `packages/components/test`
  (`grants.test.ts`, `peer-proxy.test.ts`), org-context RPC flows,
  delegation-endpoint + revocation tests.

## 8. Out of scope

- `api-messages` schema changes; the RPC router; `packages/repl`.
- Server plumbing that stays in components by definition (see Phase 4's keep
  list): CSS handler HTTP layers, storage, RPC API, webhooks, notifications,
  admin gate/transports, proxy/mirror, Temporal workflow orchestration,
  policy-engine integration.
- The Activity-Registry outbox stays in data-model (event infrastructure,
  tracked by `docs/plans/events.md`).
- Any data-model restructuring beyond the Phase 3 orphan cleanup.