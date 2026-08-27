# Improve fetchJsonLd error signaling — options

> **Status:** evaluated, not implemented. Decision deferred.
> Trigger: 404-tolerance added to `AuthorizationAgent.generateDataGrants`
> (skip authorization IRIs deleted between snapshot and re-fetch) currently
> detects the status via the thrown `Error`'s **message**
> (`/ :4(?:04|10)$/` — `fetchJsonLd` throws `new Error('failed to fetch ${iri}: ${response.status}')`).

## Problem

`packages/utils/src/jsonld.ts` `fetchJsonLd` discards the HTTP status: on
`!response.ok` it throws a plain `Error` whose only structured signal is a
message string. Call sites that need to distinguish "definitively gone"
(404/410) from "real failure" (403/500/network) must regex-match the message.

## Options

### 1. Status-carrying error (recommended)

`fetchJsonLd` keeps throwing, but attaches the status to the error:

```ts
const err = new Error(`failed to fetch ${iri}: ${response.status}`)
;(err as Error & { status?: number }).status = response.status
throw err
```

- Backward-compatible (message unchanged, extra field additive).
- `generateDataGrants` (and future tolerance sites) check `err.status`.
- No new dependencies, no call-site churn, no repo-wide migration.

### 2. Narrow optional read in utils

Add `fetchJsonLdOrUndefined(iri, fetch): Promise<unknown | undefined>` (or
effect `Option`) alongside the throwing `fetchJsonLd`; use it only at
tolerance sites (`generateDataGrants`, `getExistingGrants`).

- Zero churn for the other hundreds of call sites (missing doc = error there).
- Cost: new utils export; if effect-typed, adds `effect` as a dependency of
  the foundational utils package (it currently has none) and mixes effect
  types into otherwise plain-TS service code.

### 3. Manual fetch at the call site

`generateDataGrants` fetches each IRI via `this.fetch` and checks
`response.status` directly.

- Gives a real status with zero utils changes.
- Cost: duplicates `loadDataAuthorization`'s JSON-LD framing to build the
  POJO — worse than the problem it solves.

### 4. Repo-wide return-instead-of-throw (Option/Either) — rejected

Convert `fetchJsonLd` to always return effect `Option`/`Either`.

- **`Option` alone is the wrong shape**: this case needs three-way
  discrimination (found / gone-404 / real-failure) — `Option` collapses the
  last two. `Either` or a tagged union would be accurate, but…
- **Breaking change across the monorepo**: `fetchJsonLd` is a published,
  workspace-wide API (`@janeirodigital/interop-utils`, `^1.0.0-rc.26`)
  consumed by data-model, components, authorization-agent, temporal,
  tests — most call sites legitimately treat a missing document as an error
  and would all need unwrapping.
- Pulls `effect` into the foundational package for one tolerant callsite.

## Status

Tracked, not actionable yet. When implementing: option 1 first (smallest
principled fix), option 2 if we want type-level absence at tolerance sites.
Other 404-tolerance candidates: `getExistingGrants` (currently catch-all —
should narrow to 404/410 for the same reason).