# Reorganize authz-agent logic — grant-generation read plane (relocation optional)

> **Status:** design only, not started. Hosts the grant-generation read-plane
> work: **step 1** is the minimal listing swap (tracked in `docs/sparql.md`
> as candidate 4, moved here), **step 2** is the architectural alternative —
> relocating the grant-generation logic into the `authorization-agent`
> package. Nothing is blocked; step 1 is independent of step 2.

## 1. Problem

The grant-generation path still performs two HTTP registry-metadata reads in
`packages/data-model/src/data-authorization.ts` (both on the authz→grant path
the AA's `generateDataGrants` runs):

- `generateSourceDataGrants` lists each data registry via
  `DataRegistry.registrations(dataRegistry, registrySet.factory)` (HTTP
  `hasDataRegistration` links + per-registration bodies) to match the source
  and child registrations of a data authorization;
- `generateDelegatedDataGrants` sweeps
  `AgentRegistry.socialAgentRegistrations(...)` over HTTP (`:197`) to locate
  the data owner's reciprocal registration and grants for delegated-grant
  matching.

`docs/sparql.md` asks to move these listings onto the registry plane
(`localSparqlTransport` + `listDataRegistrations` / `getDataRegistration` /
`getSocialAgentRegistration`, which already exist in
`packages/authorization-agent/src/sparql.ts`). The obstacle is package
direction: data-model is the leaf — it cannot import the AA's transport, so
the listing source has to come from outside (injected) or the logic has to
move up. This plan hosts both answers, as steps.

## 2. Current shape (as-is)

All in `packages/data-model/src/data-authorization.ts`. The exported entry
`generateGrantsForAuthorization` has exactly one in-repo caller: the AA's
`generateDataGrants` (`authorization-agent.ts:371`).

- `generateGrantsForAuthorization(dataAuthorizations, registrySet, grantee)`
  — skips `Inherited` scope, aggregates `{ sourceGrants, delegatedGrants }`.
- `generateDataGrants(dataAuthorization, registrySet, grantee)` (data-model
  internal) — the `AllFromRole` branch iterates
  `registrySet.factory.role(data.dataOwner).members` (HTTP, stays); otherwise
  splits source vs delegated by the `dataOwner`/`grantedBy` comparisons.
- `generateSourceDataGrants` — **HTTP listing target 1**: per data registry,
  `DataRegistry.registrations` + match by `hasDataRegistration` /
  `registeredShapeTree`, `!result.length` throw, `storageIri` (HTTP
  data-plane, stays), `GrantRegistry.iriForContained`.
- `generateDelegatedDataGrants` — **HTTP listing target 2**: the
  `AgentRegistry.socialAgentRegistrations` sweep at `:197`.
- `generateChildSourceGrantData` — already listing-agnostic (receives
  `dataRegistrations` as a parameter).

## 3. Plan

### Step 1 — minimal listing swap (moved from `docs/sparql.md` candidate 4)

Leave the grant-generation assembly in data-model; inject the listing source:

- `generateSourceDataGrants` gains an optional
  `registrationsLoader?: (dataRegistry: DataRegistryData) =>
  Promise<DataRegistrationData[]>` (HTTP `DataRegistry.registrations` fallback
  when absent); the `generateDelegatedDataGrants` sweep gets the same
  treatment (an optional loader for the agent-registry listing, HTTP fallback).
- The AA's `generateDataGrants` passes loaders backed by the AA's own plane —
  `listDataRegistrations` + `getDataRegistration` (and the
  `hasSocialAgentRegistration` listing + `getSocialAgentRegistration`) over
  `localSparqlTransport(this.sparqlEndpoint)`.
- Expected caller-check outcome: the last HTTP registry-metadata reads on the
  grant path are gone; `DataRegistry.registrations` loses its external
  consumers → orphaned in src (data-model internals `registeredShapeTrees` /
  `createRegistration` remain) → final-cleanup list.
- Verify: `/test/authorization.test.ts`, `/test/services.test.ts`
  (source + delegated grant generation, incl. role- and
  delegation-scoped flows).

### Step 2 — relocate the grant-generation logic into the AA (architectural alternative)

Only if the broader goal becomes "all registry-plane query and orchestration
logic lives in the authorization-agent package" — not the vehicle for the
listing swap:

- Move the orchestration chain (`generateGrantsForAuthorization` +
  `generateDataGrants` + `generateSourceDataGrants` +
  `generateDelegatedDataGrants`) into the AA; data-model keeps the
  primitives (types, `GrantRegistry.iriForContained`,
  `DataRegistry.storageIri`, listing-agnostic `generateChildSourceGrantData`).
- The per-registry / per-agent listings use the AA's plane
  (`localSparqlTransport(this.sparqlEndpoint)` + the `list*` / `get*`
  helpers).
- data-model's `generateGrantsForAuthorization` / `generateSourceDataGrants`
  become orphaned → final-cleanup list.

**Feasible**: package direction satisfied (AA → data-model), read-plane
pieces already in the AA. **Sizing**: ~250 lines of grant semantics move; the
move changes *where* the logic lives, not *what* is HTTP (`factory.role` for
AllFromRole, `storageIri`, delegated scans stay HTTP data-plane either way).

## 4. Honest sizing

Step 1 is ~15 lines of churn for the same behavioral result (both listings on
the registry plane; HTTP fallback keeps the leaf and its tests intact). Step 2
is the large regression surface — the whole `/test` authorization + delegation
machinery exercises the relocated code — with no change in *which* reads are
HTTP.

## 5. Decision

Step 1 is the recommended path for the listing work (injection, not
relocation). Step 2 stays as the tracked option if the architectural goal
becomes explicit; it is its own workstream (own step, own `/test`
verification), not the vehicle for the listing swap.

## 6. Out of scope

- Any other logic relocation candidates in the AA or data-model (not searched;
  this plan is scoped to the grant-generation path only).
- The peer-leg chain and the unconsumed AA getters — already removed in the
  `docs/sparql.md` final cleanup.