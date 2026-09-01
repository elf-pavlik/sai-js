# Plan: Dedicated registries — split `AgentRegistry` into `SocialAgentRegistry`, `ApplicationRegistry`, `InvitationRegistry` (containment via `ldp:contains`)

> **Status:** ✅ implementation complete (incl. the DataRegistry follow-up) — decisions
> D1–D4 locked below; data-model, authorization-agent, components, application, test-utils
> and fixtures updated; `registry.trig` re-seeded and verified (TriG parses; all registration
> **and data-registration** resources contained via `ldp:contains`; no client-managed
> membership predicates remain — incl. `interop:hasDataRegistration`). All package vitest
> suites green (utils 41, data-model 75, authz-agent 73, components 35, application 7).
> `/test` (dagger suite) and the commit are the user's step, per AGENTS.md.

## Motivation

Today a single `AgentRegistry` container (`interop:AgentRegistry`, linked from the
RegistrySet via `interop:hasAgentRegistry`) holds **three different kinds** of
contained resources — social-agent registrations, application registrations and
social-agent invitations — and tracks them with **client-managed** interop
membership predicates:

- `interop:hasSocialAgentRegistration`
- `interop:hasApplicationRegistration`
- `interop:hasSocialAgentInvitation`

Those links are maintained by us, not the server:

- **Reads** (both transports, `packages/authorization-agent/src/sparql.ts` and the
  HTTP path in `packages/authorization-agent/src/agent-registry.ts` via
  `linkedIrisJsonLd`) must query/patch the predicates in *two* graphs each (the
  container graph and its `meta:` graph) because seeds store membership in
  `meta:` while runtime writes patch the plain graph — a fragile dual-graph
  contract that keeps biting (see the "deliberately not generalized — a merged
  listing would hand social-agent registrations to the application framing"
  comment on `listApplicationRegistrations`).
- **Writes** (`addApplicationRegistration` / `addSocialAgentRegistration` /
  `addSocialAgentInvitation` in `packages/authorization-agent/src/agent-registry.ts`)
  do an **extra SPARQL PATCH** (`addStatement`) to add the `has*Registration`
  triple to the container after creating the resource.

The rest of the registry set already does this the right way: `GrantRegistry`,
`RoleRegistry`, `AuthorizationRegistry` (after
`simplify-authorization-containment.md`) and `DataRegistry`'s data-instance
containers rely on **server-managed `ldp:contains`** — the SPARQL backend
inserts `parent ldp:contains child` on PUT/container-create and removes it on
DELETE, and container GETs include the quads. This plan brings the agent
registries onto the same model by **splitting one container into three
dedicated containers**, one per resource kind, and dropping the client-managed
`has*Registration` predicates entirely. Each container then lists its members
via a single `ldp:contains` read — no dual-graph, no predicate-patch.

## Current architecture

```
RegistrySet
  └─ interop:hasAgentRegistry → AgentRegistry (interop:AgentRegistry, <registry>/agent/)
       ├─ interop:hasSocialAgentRegistration → SocialAgentRegistration[]   (client-patched)
       ├─ interop:hasApplicationRegistration → ApplicationRegistration[]   (client-patched)
       └─ interop:hasSocialAgentInvitation  → SocialAgentInvitation[]     (client-patched)
```

Both the HTTP read path (data-model `AgentRegistry` behavior fns over
`linkedIrisJsonLd`) and the SPARQL path (`sparql.ts`:
`listApplicationRegistrations`, `listSocialAgentInvitations`, plus the
`hasSocialAgentRegistration` UNION inside `listContained`) read the predicates;
the write path patches them (`agent-registry.ts` `addStatement` calls).

## Target architecture

```
RegistrySet
  ├─ hasSocialAgentRegistry → SocialAgentRegistry (<registry>/social-agent/)
  │    └─ ldp:contains → SocialAgentRegistration[]        (server-managed)
  ├─ hasApplicationRegistry → ApplicationRegistry (<registry>/application/)
  │    └─ ldp:contains → ApplicationRegistration[]        (server-managed)
  └─ hasInvitationRegistry → InvitationRegistry (<registry>/invitation/)
       └─ ldp:contains → SocialAgentInvitation[]          (server-managed)
```

- **Reads** — one `ldp:contains` listing per container, the exact query
  `listContained` already runs for grants/roles/authorizations (both
  `GRAPH <container>` and `GRAPH <meta:container>` UNION stays — it is cheap
  and harmless — but the interop-predicate UNIONs disappear).
- **Writes** — `iriForContained(registry, randomUUID)` + `createContainer`/PUT
  as today; the **extra `addStatement` PATCH is deleted**. Containment appears
  automatically.
- **`packages/components/src/services/AgentRegistry.ts`** splits into three
  service modules (`SocialAgentRegistry.ts`, `ApplicationRegistry.ts`,
  `InvitationRegistry.ts`) mirroring the container split, or a single
  module with three exported model namespaces — see §Key Design Decisions.

## Scope of changes

| Package | Files | Change |
|---------|-------|--------|
| `packages/data-model` | `src/registry-set.ts` | `RegistrySetData`: replace `hasAgentRegistry: AgentRegistryData` with `hasSocialAgentRegistry` / `hasApplicationRegistry` / `hasInvitationRegistry`; update `fromJsonLd` |
| `packages/data-model` | `src/agent-registry.ts` | `AgentRegistryData` → three single-field registry POJO types (or one shared `RegistryData { id }`); see decision D2 |
| `packages/data-model` | `src/context.ts` | framing: remove `hasApplicationRegistration` / `hasSocialAgentRegistration` / `hasSocialAgentInvitation` terms (no resource body carries them); add the three new registry-link terms |
| `packages/data-model` | `src/templates/RegistrySet.ts` | bootstrap template: 3 registry containers + `has*Registry` links instead of `hasAgentRegistry` |
| `packages/data-model` | `src/index.ts` | re-export updates |
| `packages/authorization-agent` | `src/agent-registry.ts` | drop the `addStatement` patches; iterators read `LDP.contains` (container GET) instead of `linkedIrisJsonLd`; signatures take the dedicated registry POJO |
| `packages/authorization-agent` | `src/sparql.ts` | `listContained` loses the `hasSocialAgentRegistration` UNIONs; `listApplicationRegistrations` + `listSocialAgentInvitations` become `ldp:contains` readers (single query) or fold into `listContained` |
| `packages/authorization-agent` | `src/authorization-agent.ts` | `hasAgentRegistry` → the three registries at all 8 call sites (`findApplicationRegistration`, `findSocialAgentRegistration`, `findSocialAgentInvitation`, `ensureApplicationRegistration`, `typeGrantee`, `removeGrantsFromRegistration`, `findAffectedGrantees`…) |
| `packages/authorization-agent` | `src/grant-generation.ts` | `listContained(hasAgentRegistry)` → `listContained(hasSocialAgentRegistry)` |
| `packages/components` | `src/services/AgentRegistry.ts` | split into 3 service models (see §3) |
| `packages/components` | `src/services/Context.ts` | `ResolvedContext` unchanged (it carries `RegistrySetData`) |
| `packages/components` | `src/InvitationHandler.ts` | `sai.registrySet.hasAgentRegistry` → `hasInvitationRegistry` (and `hasSocialAgentRegistry` for the registration it creates) |
| `packages/components` | `src/temporal/activities/grants.ts` | `AgentRegistry.findRegistration(session.registrySet.hasAgentRegistry, …)` → find across social+application registries |
| `packages/components` | `src/ApiHandler.ts` | unchanged (dispatches by name) |
| `packages/application` | `src/application.ts` | `hasApplicationRegistration` field/property → `applicationRegistration` (loaded POJO; discovery is via the agent-id doc `Link` anchor — unchanged) |
| `packages/components` | `src/AgentIdHandler.ts` | no direct change (calls `sai.findApplicationRegistration`/`findSocialAgentRegistration`, re-pointed in authz-agent §6) — verify the `rel="registeredAgent"` link anchor still resolves |
| `environments` | `data/registry.trig`, `data/kv.json` | seeds: for acme/alice/bob/kim/yoyo/dan — move member lists out of `meta:<agent/>` into 3 containers' own graphs as `ldp:contains`; new container types + links; re-point the two **reciprocal-webhook channel topics** in `kv.json` (`bob/agent/jc5gt6/` → `bob/social-agent/jc5gt6/`, `yoyo/agent/z3k7wm/` → `yoyo/social-agent/z3k7wm/`, incl. the URL-encoded `notifications/…` index keys) |
| `packages/test-utils` | `src/data.json` | mock `RegistrySet` entry: `hasAgentRegistry` → 3 links; mock agent-registry container GET body: `ldp:contains` instead of the predicates |
| Tests | `packages/components/test/agent-registry.test.ts` | fixture ctx + query assertions → `ldp:contains`; split into the 3 service tests |
| Tests | `packages/components/test/grants.test.ts`, `data-registry.test.ts` | ctx `registrySet` fixture updated |
| Tests | `packages/authorization-agent/test/authorization-agent.test.ts` | (already `describe.skip`-gated) mock updates |
| Tests | `packages/data-model/test/framing/registry-set.test.ts` | framing fixture |
| Tests | `test/org-context.test.ts` | `registrySet.hasAgentRegistry.id` assertion → `hasSocialAgentRegistry.id` |

## Detailed changes

### 1. `packages/data-model/src/registry-set.ts`

```ts
export type RegistrySetData = {
  id: string
  type: string[]
  hasAuthorizationRegistry: AuthorizationRegistryData
  hasGrantRegistry: GrantRegistryData
  hasSocialAgentRegistry: SocialAgentRegistryData      // was hasAgentRegistry
  hasApplicationRegistry: ApplicationRegistryData
  hasInvitationRegistry: InvitationRegistryData
  hasRoleRegistry: RoleRegistryData
  hasDataRegistry: DataRegistryData[]
  hasActivityRegistry?: ActivityRegistryData
}
```

`fromJsonLd` maps the three new links the same way (`{ id: node.hasSocialAgentRegistry }`, …).
`loadRegistrySet` unchanged.

### 2. `packages/data-model/src/agent-registry.ts` → three registry POJO types

Replace the single `AgentRegistryData` with three single-field types (or one
shared shape — see decision D2):

```ts
export type SocialAgentRegistryData = { id: string }
export type ApplicationRegistryData = { id: string }
export type InvitationRegistryData = { id: string }
```

### 3. `packages/components/src/services/AgentRegistry.ts` → three models

Split the module into three self-contained service modules (the user-facing
API surface from `ApiHandler` is preserved by name):

- **`SocialAgentRegistry.ts`** — `listSocialAgentRegistrations`,
  `findSocialAgentRegistrationInContext`, `buildSocialAgentProfile`,
  `getSocialAgents`, `addSocialAgent`, `acceptInvitation` (moves here — it
  creates a social-agent registration), reciprocal discovery helper; reads
  `ctx.registrySet.hasSocialAgentRegistry`.
- **`ApplicationRegistry.ts`** — `getApplications`, `getUnregisteredApplication`,
  `buildApplicationProfile`; reads `ctx.registrySet.hasApplicationRegistry`
  (via the `ldp:contains` listing).
- **`InvitationRegistry.ts`** — `getSocialAgentInvitations`, `createInvitation`
  (now `iriForContained` the **invitation registry** instead of `hasAgentRegistry`);
  reads `ctx.registrySet.hasInvitationRegistry`.

Internal read helpers move to `queries/org.ts` shared exports (they already
live there via `sparql.ts` re-exports). The invitation `capabilityUrl` (auth
server, `invitationUrl`) stays what it is — it is **not** the resource IRI; the
invitation resource itself is created in the invitation registry container.

External consumers (`Authorization.ts`, `DataRegistry.ts`, `ShareResource.ts`,
`Admin.ts`) keep importing `findSocialAgentRegistrationInContext` /
`listSocialAgentRegistrations` — from the new `SocialAgentRegistry.ts` module
(or via a re-export barrel), so their import lines change only by path.

### 4. `packages/authorization-agent/src/agent-registry.ts` — drop `addStatement` PATCHes

- `socialAgentRegistrations` / `applicationRegistrations` / `socialAgentInvitations`
  iterators: read the container's own GET body with `getObjectsArray(LDP.contains)`
  (the `CRUDContainer`-style read — `ldp:contains` is included in container GET
  representations by `DataAccessorBasedStore`), instead of
  `linkedIrisJsonLd(..., INTEROP.hasXRegistration)`.
- `addApplicationRegistration` / `addSocialAgentRegistration` /
  `addSocialAgentInvitation`: **delete** the trailing
  `addStatement(data.id, fetch, quad)` block (quad + import). `iriForContained`
  and the create/PUT stay; containment is server-managed.
- `findRegistration` (used by `temporal/activities/grants.ts`) scans both the
  social-agent and application registries (its two sub-lookups already do).
- Follow the `AuthorizationRegistry` precedent: the `deps`/creator/ACR logic is
  untouched — only link maintenance goes away.

### 5. `packages/authorization-agent/src/sparql.ts`

- `listContained`: remove the two `INTEROP.hasSocialAgentRegistration` UNION
  branches — it is now a pure `ldp:contains` reader on **any** container
  (already how grants/roles/authorizations use it).
- `listApplicationRegistrations` + `listSocialAgentInvitations`: re-point at
  `ldp:contains` (single `UNION` over the two graphs) — or fold both into
  `listContained` and delete them, since all three will be identical queries
  (decide in D3). Keep or drop the doc-comment "deliberately not generalized"
  warning accordingly — with dedicated containers a merged listing is safe.
- `findSocialAgentRegistration` / `findApplicationRegistration` /
  `findSocialAgentInvitation` list-and-scan logic is unchanged (they take a
  container IRI argument).
- **`listDataRegistrations`** — the last remaining read on a client-managed
  membership predicate — is **removed**: its 4 call sites (AA
  `findDataRegistration`, `grant-generation.ts` `generateSourceDataGrants`,
  components `DataRegistry.ts` `buildDataRegistry` + `Authorization.ts`
  `findUserDataRegistrations`) read `listContained` directly over the
  server-managed `ldp:contains`. The `INTEROP.hasDataRegistration`
  **property** on `GrantData`/`DataAuthorizationData` POJOs is untouched (it
  is a resource-body reference, not container membership).

### 5a. DataRegistry containment — `ldp:contains` (follow-up item 1)

The same split/containment treatment applied to the *data-registry →
`data-registration`* membership, which was the one remaining client-managed
container listing (see §Observations):

- **Seeds** — for each of acme-rnd, acme-hr, alice-home, alice-work, bob,
  kim-red, kim-blue, yoyo-eu, yoyo-na, test-client: member lists moved out of
  `GRAPH <meta:<dataRegistry>>` into the **container's own graph** as
  `ldp:contains` (type stays in the meta graph, matching grants/roles).
- **Read** — the 4 `listDataRegistrations` call sites now call
  `listContained` directly and the function is **removed**; call sites (AA
  `findDataRegistration`, `generateSourceDataGrants`, components
  `buildDataRegistry` / `findUserDataRegistrations`) otherwise unchanged.
- **`createDataRegistration` stays** (unused in production — data
  registrations are seeded) but already adds **no** custom predicate:
  it only `createContainer`s the registration, so with the read switched to
  `ldp:contains` a runtime-created registration is contained by the server,
  consistent with the seeds. No change to the function other than verifying
  it and updating the surrounding docs.

### 6. `packages/authorization-agent/src/authorization-agent.ts`

Mechanical re-pointing at the three registries (8 call sites):

- `findApplicationRegistration` / `findSocialAgentRegistration` /
  `findSocialAgentInvitation` → `hasApplicationRegistry` / `hasSocialAgentRegistry` /
  `hasInvitationRegistry`.
- `ensureApplicationRegistration(registrySet.hasAgentRegistry, …)` →
  `registrySet.hasApplicationRegistry`.
- `typeGrantee`: two `listContained`/listing passes — socials from
  `hasSocialAgentRegistry`, applications from `hasApplicationRegistry`.
- `findAffectedGrantees`/`findRoleUsage` (authorization registry) and
  `revokeGrants`/`removeGrantsFromRegistration`/`generateDataGrants`:
  `removeGrantsFromRegistration`'s `findRegistrationInAgentRegistry` gets the
  social registry (grantee is a social agent there; application grants are
  cleared by the application flow — verify exact current semantics and keep them).

### 7. `packages/authorization-agent/src/grant-generation.ts`

`listContained(transport, registrySet.hasAgentRegistry.id)` →
`registrySet.hasSocialAgentRegistry.id` (delegation candidates are social
agents; comment updated).

### 8. `packages/components/src/InvitationHandler.ts`

- `sai.findSocialAgentInvitation(capabilityUrl)` — unchanged behavior, now
  reads the invitation registry internally (AA method re-pointed in §6).
- `AgentRegistry.addSocialAgentRegistration(sai.registrySet.hasAgentRegistry, …)`
  → the social-agent registry + the new module's add function (no signature
  change beyond the registry POJO).
- `setRegisteredAgent` on the invitation — unchanged (updates the invitation
  resource body, not the container).

### 9. `packages/components/src/temporal/activities/grants.ts`

`AgentRegistry.findRegistration(session.registrySet.hasAgentRegistry, …)` →
find over `hasSocialAgentRegistry` + `hasApplicationRegistry` (the AA
`findRegistration` re-pointed in §4/§6; the activity calls it, so likely just
the parameter).

### 10. `packages/application/src/application.ts`

`hasApplicationRegistration?` field + lazy `buildRegistration()`: the app
**does not list the registry** — it discovers its **own** registration IRI via
`discoverAgentRegistration` (the agent-id doc `Link: rel="registeredAgent"`
anchor served by `AgentIdHandler`, whose AA-side lookup re-points in §6) and
loads that single POJO by IRI. So the only change here is the misleading field
name → `applicationRegistration` (see decision D4); `getDataGrants` /
`getGranted` keep operating on the loaded POJO unchanged.

### 11. `packages/data-model/src/templates/RegistrySet.ts` (bootstrap)

```trig
interop:hasSocialAgentRegistry <${id}social-agent/>;
interop:hasApplicationRegistry <${id}application/>;
interop:hasInvitationRegistry <${id}invitation/>;
```

plus three container blocks (`a <Type>, ldp:Resource` in their `meta:` graphs),
mirroring the current `agent/` block. (`Account.ts` is untouched — it composes
the template.)

### 12. `environments/data/registry.trig` ✅ (landed with this plan's review)

For each of **acme, alice, bob, kim, yoyo, dan**: the single `meta:<…/agent/>` container block
was replaced with three containers — types stay in `meta:` graphs, memberships moved to the
**containers' own graphs** as `ldp:contains` (the `GrantRegistry`/`RoleRegistry` layout precedent):

```trig
GRAPH <meta:https://registry/<x>/agent/> {
  <https://registry/<x>/agent/>
    a interop:AgentRegistry, ldp:Resource;
    interop:hasSocialAgentRegistration <…/>;   # per owner
    interop:hasApplicationRegistration <…/>;   # alice, bob only
    interop:hasSocialAgentInvitation <…>;      # kim only
}
```

with three containers whose memberships live in the **containers' own graphs**
as `ldp:contains` (the `GrantRegistry`/`RoleRegistry` layout precedent):

```trig
GRAPH <meta:https://registry/<x>/social-agent/> {
  <https://registry/<x>/social-agent/>
    a interop:SocialAgentRegistry, ldp:Resource .
}
GRAPH <https://registry/<x>/social-agent/> {
  <https://registry/<x>/social-agent/>
    ldp:contains <https://registry/<x>/social-agent/<uuid>/>, … .
}
```

(plus `application/` and `invitation/` analogues), and the RegistrySet meta
graphs get the three new `interop:has*Registry` links instead of
`interop:hasAgentRegistry`. **Consequential decision (D1)**: whether the
containers keep mining the interop vocabulary (`interop:SocialAgentRegistry`
etc. — not defined by the spec today) or a new `sai:`-style term set is
introduced; whatever is chosen lives in `packages/utils/src/namespaces.ts` and
`data-model/src/context.ts` together. The registration **resource** graphs are
unchanged (only their container link disappears). The `map.json` prefix map
needs the three new registry paths if the seeds/demos reference them by prefix.

### 13. `packages/test-utils/src/data.json` + component test fixtures

- Mock `RegistrySet` node (`…13e60d32…`): `hasAgentRegistry` →
  `hasSocialAgentRegistry` / `hasApplicationRegistry` / `hasInvitationRegistry`;
- mock agent-registry container GET body: the interop predicates →
  `ldp:contains` (add the `ldp:` prefix), matching what CSS would serve.
- `packages/components/test/grants.test.ts:127`, `agent-registry.test.ts:59`
  `registrySet` fixtures → three links.
- `test/org-context.test.ts:128` assertion → `hasSocialAgentRegistry.id`.

### 14. Component service tests (`agent-registry.test.ts`)

Split/re-pointed per new module: the SPARQL-listing assertions change from
"`expect(query).toContain('hasApplicationRegistration')`" to the
`ldp:contains` query; the `orgCtx` fixture registers the three registry IRIs.
Add a unit assertion that `addSocialAgentRegistration`-style writes issue
**no** container PATCH (regression guard for the deleted `addStatement`).

## Migration order

1. **data-model** — registry-set POJO + framing + templates + `namespaces.ts`
   (new registry terms, per D1); drop the three `has*Registration` framing terms.
2. **authorization-agent** — `sparql.ts` listing queries → `ldp:contains`;
   `agent-registry.ts` write paths lose the `addStatement` PATCH; iterators
   read `LDP.contains`; `authorization-agent.ts` + `grant-generation.ts`
   re-pointed at the three registries.
3. **components** — `AgentRegistry.ts` split into the three service modules;
   `InvitationHandler.ts`, `temporal/activities/grants.ts`, `application`
   package re-pointed.
4. **fixtures/tests** — `registry.trig` re-seed, `test-utils/data.json`, unit
   test fixtures + assertions, `test/org-context.test.ts`.
5. **verification** — `packages/*` vitest suites + the `/test` integration
   suite (invitation flow, application grants, org-context, revocation) run
   green; agent-discovery/reciprocal-webhook tests unaffected in behavior.

Everything must land gated by green tests at each step (repo convention:
only the user runs `/test`).

## Key design decisions

1. **D1 — registry types & RegistrySet-link predicates (RESOLVED: extend the interop
   namespace)** — `interop:SocialAgentRegistry`, `interop:ApplicationRegistry`,
   `interop:InvitationRegistry` types and `interop:hasSocialAgentRegistry` /
   `interop:hasApplicationRegistry` / `interop:hasInvitationRegistry` RegistrySet links are
   added to the interop vocabulary (they do not exist in the spec yet — we extend it, and
   upstream the terms). The fixture uses them already; `packages/utils/src/namespaces.ts` and
   `data-model/src/context.ts` get the terms during implementation.
2. **D2 — registry POJO types (RESOLVED: explicit types)** — `SocialAgentRegistryData` /
   `ApplicationRegistryData` / `InvitationRegistryData` (each `{ id: string }`), so re-pointing
   mistakes type-check. **Follow-up (noted):** give the three (four) other registries the same
   treatment — `AuthorizationRegistryData`, `GrantRegistryData`, `RoleRegistryData` (and
   `DataRegistryData`) are all still the shared `{ id: string }` shape
   (`packages/data-model/src/{authorization,grant,role,data}-registry.ts`).
3. **D3 — one listing query (RESOLVED: fold)** — `listApplicationRegistrations` /
   `listSocialAgentInvitations` fold into `listContained` (all three are now the identical
   `ldp:contains`-in-both-graphs query); the specialized queries and the “not generalized”
   warning go away. Keep names as thin re-exports only if a call site reads better.
4. **D4 — `packages/application` field naming (RESOLVED: rename)** — `hasApplicationRegistration`
   → `applicationRegistration` (loaded POJO; the app loads its own registration via the AA-doc
   `Link` anchor, not the registry listing). The class is internal to the `application` package.
5. **Invitation resource IRIs live in the invitation registry** — only the
   *resource* moves; `capabilityUrl` (auth-server `/.sai/invitations/…`) and the
   `acceptInvitation` POST flow are unchanged. The trick from
   `simplify-authorization-containment.md` carries over: create/update no longer
   touches the container, so nothing needs `fetchData()`-style refresh on the
   HTTP data-model path because `CRUDContainer` (or the plain container GET)
   already re-reads on `fetch()`.

## Observations / out of scope

- **Containment for registration **resources** was never `ldp:contains`** —
  the current `registry.trig` puts memberships only in `meta:<agent/>`; after
  this plan both graphs are read but only the containers' own graphs carry the
  (server-managed) listings, matching grants/roles.
- `hasAccessNeedGroup` / `hasDataGrant` / `hasAdminGrant` / `reciprocalRegistration`
  on the registration POJOs are untouched — only *container* membership moves.
- The `data-model/src/context.ts` framing terms for `hasApplicationRegistration` /
  `hasSocialAgentRegistration` / `hasSocialAgentInvitation` appear to be legacy
  container-framing terms (no resource body carries them post-POJO-refactor);
  their removal is cleanup, verified by the full build + tests rather than
  assumed — confirm no `toDataset` path emits them.
- **DataRegistry data-instance containment** (`ldp:contains` inside a data
  registration's own graph) is a different mechanism
  (`DataAccessorBasedStore` mirror) and is not affected.
- **The DataRegistry listing is now `ldp:contains` too** (follow-up item 1):
  `listDataRegistrations` was the last client-managed container read
  (`interop:hasDataRegistration`); it is folded onto the same
  server-managed model as the three agent registries. `createDataRegistration`
  is **kept as-is** (still unused in production, still adds no predicate) —
  only the listing/seeds changed.