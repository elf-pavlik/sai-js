# Simplify factories — `ApplicationFactory` as base, drop `readable`/`crud`/`immutable`

> **Status:** ✅ done — Phases 1–3 landed (commit `e156f5e0 [data-model] simplify factories`).
>
> **Goal.** Collapse the three-factory hierarchy (`BaseFactory` + empty `ApplicationFactory` + `AuthorizationAgentFactory`) to **two**, with `ApplicationFactory` as the base class, and remove the `readable`/`crud`/`immutable` namespaces — every factory method becomes a top-level method.
>
> **Why now.** Since the move from classes to POJOs, the factory only *creates structures*: read methods build POJOs from the wire (`loadX(iri, fetch)` modules), and the `crud.*(iri, data)` / `immutable.dataGrant(iri, data)` branches just construct POJOs (`{ ...data, id: iri }`). No factory method ever writes — actual writes live in modules (`putRole`/`putJsonLd` in `crud/*`, SPARQL patches, `container.create`, component services). The namespace split is a leftover of the class era, and the empty `ApplicationFactory extends BaseFactory {}` exists only as a named alias.
>
> **Phase structure:**
> 1. ✅ **done** — **Re-parent** — `ApplicationFactory` becomes the base (takes over `BaseFactory`'s body); `AuthorizationAgentFactory extends ApplicationFactory`; delete `BaseFactory` and `InteropFactory`. Small, type-only, ends green.
> 2. ✅ **done** — **Flatten** — strip `.readable.`/`.crud.`/`.immutable.` at every call site (~100 src + test sites, mechanical). Ends green.
>
> **Each phase ends green**: after every phase `npm run build` (turbo) + `npm test` (turbo, packages) must pass.

---

## Current state (surveyed)

```
BaseFactory                        // readable + fetch + randomUUID
├── ApplicationFactory {}          // EMPTY — pure alias, no added members
└── AuthorizationAgentFactory      // readable (extended) + crud + immutable
                                   // ctor: (webId, agentId, deps)
```

**Factory usage by package (source, excluding `dist/`):**

| Package | Factory type | Usage |
|---|---|---|
| `data-model/src/base-factory.ts` | `BaseFactory` | defines `readable: BaseReadableFactory`, `readableFactory()` closures |
| `data-model/src/application-factory.ts` | `ApplicationFactory` | 3-line empty subclass |
| `data-model/src/authorization-agent-factory.ts` | `AuthorizationAgentFactory` | `extends BaseFactory`; adds `readable` members + `crud` + `immutable` factories |
| `data-model/src/grant.ts` (:128, :170) | `BaseFactory` (type only) | `getDataInstanceIterator` / `getChildInstanceIris` params |
| `data-model/src/application-registration.ts` (:88) | `BaseFactory` (type only) | `getDataGrants` param |
| `data-model/src/data-instance.ts` (:49,:93,:129), `shape-tree.ts` (:117) | `InteropFactory` | internal read helpers |
| `data-model/src/crud/*` (agent-registry, data-registry, role-registry, authorization-registry, grant-registry, registry-set, agent-registration, social-agent-registration, container) | `AuthorizationAgentFactory` | ~60 refs; **the only place the `crud.*(iri, data)` creation branches are used** (agent-registry.ts:126/164/206, data-registry.ts:70) |
| `data-model/src/crud/registry-set.ts` | `AuthorizationAgentFactory` | **`RegistrySetData` carries a `factory: AuthorizationAgentFactory` field** (behavior carrier for consumers like `data-authorization.ts:154/208/407`) |
| `application/src/application.ts` (:60) | **`new ApplicationFactory({...})`** | instantiates the base; uses `readable.applicationRegistration`, `readable.dataRegistration`, `factory.randomUUID` (via `Grant.iriForNew`) |
| `authorization-agent/src/authorization-agent.ts` (:89) | `new AuthorizationAgentFactory(webId, agentId, {...})` | 10 direct calls (all single-arg **loads**): `crud.socialAgentRegistration` ×2, `crud.registrySet` ×1, `readable.{dataAuthorization, dataInstance ×2, dataRegistration, shapeTree, webIdProfile}` |
| `authorization-agent/src/authorization.ts` | `AuthorizationAgentFactory` (typed :41/:92/:129) | threads `factory` into `generateAuthorization`/`generateDataAuthorizations`/`replaceDataAuthorizationsForGrantee`; uses `factory.fetch` (DELETE, :106) and `randomUUID` via `AuthorizationRegistry.iriForContained` |
| `components/src/SaiPermissionsEngine.ts` (:2,:271) | **`new ApplicationFactory({ fetch, randomUUID: crypto.randomUUID })`** | uses exactly one method: `factory.readable.shapeTree` (:275) |
| `components/src/services/Authorization.ts` (:19,:38) | `AuthorizationAgentFactory` (type only) | the **only** explicit type use in components — `formatAccessNeed` param |
| `components/src/**` (services, temporal/activities, InvitationHandler) | `saiSession.factory` (via `AuthorizationAgent` session type) | ~30 direct calls, all single-arg **loads**: `crud.socialAgentRegistration` ×8, `crud.role` ×4, `readable.{shapeTree ×5, clientIdDocument ×4, dataInstance ×3, dataRegistration ×2, accessNeedGroup ×2, webIdProfile ×1}`; plus factory threaded into `getDataGrants`, `Grant.getDataInstanceIterator`, `AccessNeed.getDescription`, `ShapeTree.getDescription`, `AgentRegistry.addSocialAgentRegistration`, `discoverAndUpdateReciprocal`, `addDataGrant` |

**Key facts driving the design:**
1. Every `crud.*` / `readable.*` call in `application`, `authorization-agent`, and `components` is a **single-arg load**. The `(iri, data)` creation branches are used only inside `data-model`'s own `crud/` modules.
2. The `AuthorizationAgentFactory` type name barely leaks into components (1 file); everything else flows through the `AuthorizationAgent` session type.
3. `fetch` and `randomUUID` must stay public on the base factory — called directly (`authorization.ts` DELETE) and used indirectly (`iriForContained`, `Grant.iriForNew`).
4. `crud/container.ts:16/:32` already uses minimal structural types (`{ randomUUID(): string }`, `{ webId; agentId }`) — unaffected by the refactor.

---

## Target shape

```ts
// ApplicationFactory — the base (what an *application* session needs)
export class ApplicationFactory {
  fetch: WhatwgFetch
  randomUUID: () => string
  constructor(deps: FactoryDependencies)

  dataInstance(iri, shapeTreeIri?, descriptionLang?): Promise<DataInstanceData>
  applicationRegistration(iri): Promise<ApplicationRegistrationData>   // read only
  dataRegistration(iri): Promise<DataRegistrationData>                 // read only
  shapeTree(iri, descriptionLang?): Promise<ShapeTreeData>
  shapeTreeDescription(iri): Promise<ShapeTreeDescriptionData>
  dataGrant(iri): Promise<GrantData>                                   // read only
  webIdProfile(iri): Promise<WebIdProfileData>
  clientIdDocument(iri): Promise<ClientIdDocumentData>
}

// AuthorizationAgentFactory — base + auth-agent structures
// Follow-up: webId/agentId were REMOVED from the factory — the write modules
// (`crud/container.ts`, `crud/agent-registry.ts`) now take `creator: AgentAndClient`
// ({ agent, client }) explicitly; callers pass the session's `sai.webId`/`sai.agentId`.
export class AuthorizationAgentFactory extends ApplicationFactory {
  constructor(deps: FactoryDependencies)   // same deps as the base

  // overloads: read (no data) or construct (data)
  applicationRegistration(iri, data?: Omit<AgentRegistrationData, 'id' | 'type'>)
  dataRegistration(iri, data?: DataRegistrationData)
  dataGrant(iri, data?: GrantData)                                     // data → FinalGrantData
  socialAgentRegistration(iri, data?)
  socialAgentInvitation(iri, data?)
  role(iri, data?)
  roleRegistry(iri); dataRegistry(iri); authorizationRegistry(iri)
  grantRegistry(iri); agentRegistry(iri); registrySet(iri)
  // auth-specific reads
  dataAuthorization(iri)
  accessNeed(iri, descriptionLang?); accessNeedGroup(iri, descriptionLang?)
  accessNeedDescription(iri); accessNeedGroupDescription(iri)
  accessDescriptionSet(iri)
}
```

Design decisions:
- **Base stays minimal** (today's `BaseFactory` readable set). The `data?`-bearing creators live on `AuthorizationAgentFactory` — matches observed usage (app-side never creates) and keeps `Application`'s factory narrow. *(Alternative rejected: all creators on the base "since structure creation is generic" — would widen the app-side API for no consumer.)*
- **Overloads** (`applicationRegistration(iri)` on base, `(iri, data?)` on subclass) are legal TS: the subclass method accepts at least what the base accepts. When no `data` is given, the subclass implementation delegates to the same `loadX(iri, fetch)` module function the base uses — **no `super` call needed**.
- **Method implementation style**: methods are **arrow-function class fields** (own instance properties, compiled to constructor assignments) — preserves detachability and, unlike `this`-bound prototype methods, stays **mockable by assignment** (the `crud/data-registry.test.ts` factory-method mock relies on this). `dataGrant` is the one exception: an overloaded prototype method (`dataGrant(iri, data): FinalGrantData` synchronous creator + `dataGrant(iri): Promise<GrantData>` read) — TS forbids a property→method override, and the sync creator keeps `pojo/data-grant.test.ts`'s `Grant.toJsonLd` usage un-`await`ed. The one place that previously destructured — `grant.ts:126` `const { readable } = factory` — was rewritten in Phase 2 anyway.

---

## Phase 1 — ✅ done — Re-parent: `ApplicationFactory` is the base

**Files:**
1. `packages/data-model/src/application-factory.ts` — absorb `base-factory.ts`: move the `BaseFactory` class body here, rename the class to `ApplicationFactory`, keep `BaseReadableFactory` interface (or inline it; it's still referenced by `authorization-agent-factory.ts`). No behavior changes.
2. `packages/data-model/src/base-factory.ts` — **delete**.
3. `packages/data-model/src/authorization-agent-factory.ts` — `extends ApplicationFactory` (import from `./application-factory`); everything else unchanged this phase.
4. `packages/data-model/src/index.ts`:
   - drop the `BaseFactory` export;
   - `InteropFactory` — since `AuthorizationAgentFactory extends ApplicationFactory`, the union `ApplicationFactory | AuthorizationAgentFactory` collapses to `ApplicationFactory`. **Replace the 4 internal refs and drop the alias**: `shape-tree.ts:117` (`factory: InteropFactory` → `factory: ApplicationFactory`) and `data-instance.ts:49/93/129` (`InteropFactory` / `InteropFactory['fetch']` → `ApplicationFactory`). No test uses `InteropFactory`.
5. `packages/data-model/src/grant.ts` (:128, :170) — `factory: BaseFactory` → `factory: ApplicationFactory` (accepts session factories, since AAF extends AF).
6. `packages/data-model/src/application-registration.ts` (:88) — `factory: BaseFactory` → `factory: ApplicationFactory`.

**Tests:**
- `test/base-factory.test.ts` — `new BaseFactory({...})` → `new ApplicationFactory({...})` (3 sites); rename file to `test/application-factory.test.ts`.

**Verification:** build + test green; public surface for consumers (`application.ts`, `SaiPermissionsEngine.ts`) unchanged — they already use `ApplicationFactory`.

---

## Phase 2 — ✅ done — Flatten namespaces

Strip `.readable.` / `.crud.` / `.immutable.` — every method becomes top-level.

**Factory files:**
1. `packages/data-model/src/application-factory.ts` — rewrite: constructor assigns `this.fetch`, `this.randomUUID`, then the 8 base methods as closures (the current `readableFactory()` bodies, minus the wrapper object). Delete `BaseReadableFactory` (members become class members).
2. `packages/data-model/src/authorization-agent-factory.ts` — rewrite: constructor calls `super(deps)`, assigns the extra methods on `this`, shadowing `applicationRegistration`/`dataRegistration`/`dataGrant` with the `(iri, data?)` overloads (no-data path calls the same `loadX(iri, this.fetch)` module functions). Recursive reads (`accessNeed` → children, `accessNeedGroup` → needs) call `this.accessNeed(...)` / `this.accessNeedGroup(...)`. Delete `AuthorizationAgentReadableFactory`, `CRUDFactory`, `ImmutableFactory`, `crudFactory()`, `immutableFactory()`, and the `readableFactory()` override + `...super.readableFactory()` spread.

**Call-site sweep (mechanical: `.readable.` → `.`, `.crud.` → `.`, `.immutable.` → `.`):**

| Area | Sites | Notes |
|---|---|---|
| `data-model/src` internals | `grant.ts:126` (`const { readable } = factory` → direct calls), `grant.ts:172`, `application-registration.ts:90`, `data-instance.ts:134`, `shape-tree.ts:137`, `access-need.ts:87/:99`, `access-need-group.ts:68`, `access-description-set.ts:102/:106`, `data-authorization.ts:138/:154/:208/:407`, `crud/*` (agent-registry, data-registry, role-registry, authorization-registry, grant-registry, registry-set, agent-registration, social-agent-registration, container) | the `crud/*(iri, data)` creation calls become `factory.X(iri, data)` — the AAF overloads |
| `application/src/application.ts` | :79, :167 (`.readable.` → `.`) | `Grant.iriForNew(grant, factory.randomUUID)` unchanged |
| `authorization-agent/src/authorization-agent.ts` | 10 sites (`.crud.` ×3, `.readable.` ×7) | `authorization.ts` `factory.fetch` unchanged |
| `components/src` | ~30 sites: services `AgentRegistry` (34,48,59,103,133), `Authorization` (41,109,136,143,153,178,306), `DataRegistry` (20,52,79,110,146,148,163,183), `RoleRegistry` (43,76), `ShareResource` (17,19); `temporal/activities/grants.ts` (103,163), `reciprocal.ts` (33); `SaiPermissionsEngine.ts:275` | `AgentRegistry.ts:133` chain `agent.factory.readable.clientIdDocument(id).then(...)` → `factory.clientIdDocument(id).then(...)` |
| `data-model/test` | 136 `.readable.`/`.crud.`/`.immutable.` refs across `readable/*`, `crud/*`, `framing/*`, `pojo/*`, `authorization-agent-factory.test.ts`, `base-factory.test.ts` | mechanical sweep; `authorization-agent-factory.test.ts`'s `crud.` → `.` |
| `authorization-agent/test/authorization-agent.test.ts` | factory refs | sweep |

**Unchanged:** `crud/container.ts` structural factory types; `RegistrySetData.factory: AuthorizationAgentFactory` field (type name survives); `FactoryDependencies` in `src/index.ts`; `AuthorizationAgentFactory` constructor signature.

**Verification:** build + test green. Run a `grep -rn "\.readable\.\|\.crud\.\|\.immutable\." --include="*.ts" packages/` (excluding `dist`/`.rollup.cache`) to confirm zero remaining refs.

---

## Phase 3 — ✅ done — Cleanup

- Update `docs/plans/refactor-data-model.md` (:34 lists three DI seams → two: `ApplicationFactory`, `AuthorizationAgentFactory`). Historical tables in `refactor-data-model-followup.md` / `cleanup-fetch-utils.md` can stay (they describe past work).
- If desired, drop the now-redundant `InteropFactory` mention from any remaining comments.

---

## Verification (final)

1. `npm run build` (turbo) + `npm test` (turbo, packages) green after each phase.
2. `grep -rn "BaseFactory" packages/ --include="*.ts"` → only historical docs remain.
3. `grep -rn "\.readable\.\|\.crud\.\|\.immutable\." packages/ --include="*.ts"` → zero (excluding `dist`/`.rollup.cache`).
4. Spot-check consumer semantics unchanged: `SaiPermissionsEngine` still builds a base factory with global `fetch`; `Application` and `AuthorizationAgent` sessions still expose `.factory` with the same method names minus the namespace prefix.
