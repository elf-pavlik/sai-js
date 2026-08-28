# Reorganize authz-agent logic — move grant generation out of data-model

> **Status:** design only — captures one option raised while working through
> `docs/sparql.md` candidate 4, not started. Candidate 4's *minimal* path
> (inject a SPARQL registrations loader into data-model) is tracked in
> `docs/sparql.md`; this plan tracks the *architectural* alternative: relocate
> the grant-generation orchestration into the `authorization-agent` package.

## 1. Problem

The grant-generation path still performs one HTTP registry-metadata read: in
`packages/data-model/src/data-authorization.ts`,
`generateSourceDataGrants` lists each data registry via
`DataRegistry.registrations(dataRegistry, registrySet.factory)` (HTTP
`hasDataRegistration` links + per-registration bodies) to match the source and
child registrations of a data authorization.

`docs/sparql.md` candidate 4 asks to move that listing onto the registry
plane (`localSparqlTransport` + `listDataRegistrations` /
`getDataRegistration`, which already exist in
`packages/authorization-agent/src/sparql.ts`). The obstacle is package
direction: data-model is the leaf — it cannot import the AA's transport, so
the listing source has to come from outside or the logic has to move up.

While considering the injection fix, the question was raised: instead of
passing a loader into data-model, **move the grant-generation logic into the
authorization-agent package outright** (the AA owns `sparqlEndpoint` and the
read plane). This plan records that option, sized honestly.

## 2. Current shape (as-is)

All in `packages/data-model/src/data-authorization.ts`. The exported entry has
**exactly one in-repo caller**: the AA's `generateDataGrants`
(`packages/authorization-agent/src/authorization-agent.ts:371`, invoking
`generateGrantsForAuthorization(dataAuthorizations, this.registrySet, grantee)`).

- `generateGrantsForAuthorization(dataAuthorizations, registrySet, grantee)`
  — exported convenience; skips `Inherited`-scope authorizations, aggregates
  `{ sourceGrants, delegatedGrants }`.
- `generateDataGrants(dataAuthorization, registrySet, grantee)` (data-model
  internal) — the `AllFromRole` branch iterates
  `registrySet.factory.role(data.dataOwner).members` (HTTP, would **stay**
  HTTP); otherwise splits source vs delegated by the
  `dataOwner`/`grantedBy` comparisons.
- `generateSourceDataGrants` — **the only part with the HTTP
  `DataRegistry.registrations` read**: per data registry, list + match by
  `hasDataRegistration` / `registeredShapeTree`, throw if nothing matched
  (`'no data grants were generated!'`), resolve `storageIri` (HTTP
  data-plane, stays), mint grant IRIs via `GrantRegistry.iriForContained`.
- `generateDelegatedDataGrants` — delegated-grant branch.
- `generateChildSourceGrantData` — recursive child matching; already
  listing-agnostic (receives `dataRegistrations` as a parameter).

## 3. The relocation option

Move the orchestration chain (`generateGrantsForAuthorization` +
`generateDataGrants` + `generateSourceDataGrants` +
`generateDelegatedDataGrants`) into `packages/authorization-agent`:

- The AA imports data-model **primitives** only: `FinalGrantData` /
  `GrantData` types, `GrantRegistry.iriForContained`, `DataRegistry.storageIri`,
  and the listing-agnostic `generateChildSourceGrantData`.
- The per-registry listing uses the AA's own plane:
  `listDataRegistrations(localSparqlTransport(this.sparqlEndpoint), id)` +
  `getDataRegistration` per IRI.
- data-model's `generateGrantsForAuthorization` / listing-based
  `generateSourceDataGrants` become orphaned in src (final-pass cleanup).

**Feasible**: yes — package direction is satisfied (AA → data-model), and the
read-plane pieces are already in the AA.

## 4. Honest sizing — why it was deferred from candidate 4

- ~250 lines of grant-generation semantics move (source/delegated split
  rules, `AllFromRole` member iteration, child recursion, `!result.length`
  throw, storage resolution), all exercised by the `/test` authorization and
  delegation suites.
- Moving the logic changes **where** it lives, not **what** is HTTP:
  `factory.role` (AllFromRole), the delegated scans, and `storageIri` remain
  HTTP data-plane reads either way. The single HTTP *registry-listing* read —
  the actual subject of candidate 4 — is fixed by the minimal loader option at
  ~15 lines with zero relocation risk.
- The AA currently carries only the new unit tests from `docs/sparql.md`
  steps 2–4 and candidates 1–3; transplanting the grant engine onto it is a
  large regression surface for one listing swap.

## 5. Decision

Candidate 4 proceeds independently in `docs/sparql.md` (recommended: the
optional `registrationsLoader` parameter on
`generateGrantsForAuthorization`, threaded into `generateSourceDataGrants`,
HTTP fallback when absent; the AA passes the SPARQL-backed loader). This plan
stays as the tracked option if the broader goal is "all registry-plane query
and orchestration logic lives in the authorization-agent package" — that is an
architectural pass in its own right (own step, own `/test` verification),
not the vehicle for candidate 4.

## 6. Out of scope

- Any other logic relocation candidates in the AA or data-model (not searched;
  this plan is scoped to the grant-generation chain only).
- The orphaned data-model authorization/registry-listing cleanup (tracked in
  `docs/sparql.md`, final pass).