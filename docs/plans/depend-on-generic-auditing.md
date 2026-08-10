# Plan: Remove `setTimestampsAndAgents` and rely on generic auditing

## Goal

Remove `setTimestampsAndAgents` from `packages/data-model/src/crud/container.ts` and stop writing the interop properties it sets (`interop:registeredBy`, `interop:registeredWith`, `interop:registeredAt`, `interop:updatedAt`) from application code. Creation metadata should instead be provided by a generic auditing mechanism (server-side audit log / Solid server metadata), not hand-written by sai-js on every container creation.

The removal is safe today because **nothing in this repository reads these four properties** — the writes are dead data from the consumers' perspective (see "Reads" below).

## What `setTimestampsAndAgents` does

Defined at `packages/data-model/src/crud/container.ts:25-54`. Given an in-memory `DatasetCore` it mutates it, replacing any existing values for:

| Property | Value written | Notes |
|----------|---------------|-------|
| `interop:registeredBy` | `"<creator.agent>"^^xsd:string` | Agent IRI stored as a **string literal**, not an IRI — arguably incorrect modeling |
| `interop:registeredWith` | `"<creator.client>"^^xsd:string` | Client IRI stored as a **string literal**, not an IRI |
| `interop:registeredAt` | `"<now>"^^xsd:dateTime` | `new Date().toISOString()` at call time |
| `interop:updatedAt` | `"<now>"^^xsd:dateTime` | `new Date().toISOString()` at call time |

Production call sites:
- **Only one**: `createContainer` (`container.ts:131-149`) calls it with `includeRegistered = true`, so all four properties are always written, on every container created through this module (PUT empty container + PATCH description resource).
- No caller ever passes `includeRegistered = false`, so the flag is dead API surface.

## All uses of the properties it sets

### Writes (production)
- `packages/data-model/src/crud/container.ts:43-51` — the only production writer.

### Reads (production)
- **None.** `rg` for `registeredBy|registeredWith|registeredAt|updatedAt` across `packages/*/src` finds only:
  - Comments: `packages/api-messages/src/effect.ts:44-45,144-145` (commented-out schema fields `authorizationDate`/`lastUpdateDate`), `packages/components/src/services/AgentRegistry.ts:30-31,110-111` (commented-out mapping lines). Can be deleted or left; they reference the terms but are inert.
  - `packages/utils/src/namespaces.ts:60-63,73` — the terms listed in the shared `INTEROP` namespace. **Keep** (generic namespace, used elsewhere; harmless).

### Test / fixture usage (no behavioral dependency)
- `packages/data-model/test/crud/container.test.ts:71-124` — 4 tests in `describe('setTimestampsAndAgents')` covering: registeredBy/registeredWith values, dateTime datatypes, `includeRegistered=false` behavior, and replacement of existing values. Must be deleted with the function.
- `packages/utils/test/{turtle-parser, turtle-serializer, match, sparql-update}.test.ts` — generic RDF round-trip tests that happen to use these predicates as sample data. **Unaffected**; leave as-is.
- `packages/css-storage-fixture/dev/pod/yori/agentRegistry/alice-inv$.ttl:8` — fixture data with `interop:registeredAt`. Harmless; optional cleanup.

### Pre-existing inconsistency (argument for removal)
- `interop:updatedAt` is only written at **creation** time. Update paths never refresh it: `updateRole` (`crud/role-registry.ts:53`), grant/statement updates in `crud/social-agent-registration.ts:153,188`, `removeStatement`/`replaceStatement`/`applyPatch` in `container.ts` do not touch it. The value is therefore stale the moment anything changes — a misleading "updated" timestamp.

## Removal steps

### 1. `packages/data-model/src/crud/container.ts`
- Delete `setTimestampsAndAgents` (lines 25-54).
- `createContainer`: drop the `creator: AgentAndClient` parameter and the `setTimestampsAndAgents(dataset, iri, creator, true)` call. The `includeRegistered` concept disappears entirely (it had no other callers).
- Remove now-unused imports: `XSD`, `getOneMatchingQuad` (from `@janeirodigital/interop-utils`), `INTEROP` (from the same import), `NamedNode`/`Quad_Object` (from `@rdfjs/types`), and `AgentAndClient` (from `../templates/types`). Keep `DatasetCore`, `Quad`, `DataFactory`, `Store` (still used by the remaining functions).

### 2. Drop `creator` from the create functions that only forwarded it
Each of these functions threads `creator` solely into `createContainer`; remove the parameter and the forwarding:

| Function | File |
|----------|------|
| `createApplicationRegistration` | `src/application-registration.ts:67-77` |
| `createDataRegistration` | `src/data-registration.ts:58-68` |
| `createSocialAgentRegistration` | `src/crud/social-agent-registration.ts:108-120` |
| `createAgentRegistry` | `src/crud/agent-registry.ts:212-220` |
| `createDataRegistry` | `src/crud/data-registry.ts:102-110` |
| `createAuthorizationRegistry` | `src/crud/authorization-registry.ts:97-109` |
| `createGrantRegistry` | `src/crud/grant-registry.ts:21-29` |
| `createRoleRegistry` | `src/crud/role-registry.ts:78-86` |

Keep `creator` where it is used for something else:
- `crud/agent-registry.ts` `addApplicationRegistration` (line ~131) and `addSocialAgentRegistration` (line ~163) still need `creator` for their own `setAcr(...)` calls — they keep the parameter but stop passing it to `createApplicationRegistration`/`createSocialAgentRegistration`.
- `crud/agent-registry.ts` `addSocialAgentInvitation` has no `creator` today; unchanged.

Remove the now-unused `AgentAndClient` imports in the files above (verify each — e.g. `application-registration.ts`, `data-registration.ts`, `social-agent-registration.ts` import it only for the dropped parameter; the `crud/*` registry files that keep `setAcr` calls still need it).

### 3. Tests
- `packages/data-model/test/crud/container.test.ts`: delete the whole `describe('setTimestampsAndAgents', ...)` block (lines 71-124). Remove imports that become unused there (`INTEROP`, `XSD`, `getOneMatchingQuad`, `getAllMatchingQuads` — verify against the remaining `replaceStatement`/`applyPatch` tests; `DataFactory` stays).
- Grep the test suite for assertions on the four properties and update/remove as found (`rg "registeredBy|registeredWith|registeredAt|updatedAt" packages --glob '*.test.ts'`).

### 4. Residual cleanup (optional)
- Delete the commented-out schema fields in `packages/api-messages/src/effect.ts` and the commented-out mappings in `packages/components/src/services/AgentRegistry.ts` (they reference removed data), or leave — inert either way.
- Optionally remove `interop:registeredAt` from `packages/css-storage-fixture/dev/pod/yori/agentRegistry/alice-inv$.ttl`.
- **Keep** `packages/utils/src/namespaces.ts` entries and the generic `packages/utils/test/*` fixtures.

### 5. Verification
- `pnpm typecheck` (or `turbo run build`) — proves the parameter/import removals are complete.
- `pnpm test` for `packages/data-model` (and root integration tests) — proves no behavioral dependency on the removed properties.

## Dependency on generic auditing

This plan is named for, and gated on, a **generic auditing mechanism** being available to provide creation metadata (who created, when, with which client). Once that exists (e.g. server-side audit resources, Solid protocol metadata, or a future shared auditing module), the app no longer needs to mint these properties itself. Prerequisites/questions:

- Confirm the auditing mechanism covers at least: creator agent, creator client, creation time, last modification time — the four facts currently written here.
- Confirm nothing outside this repo (e.g. `@janeirodigital/interop-utils` consumers, other agents) reads `interop:registeredBy`/`registeredWith`/`registeredAt`/`updatedAt` from resources created by sai-js; in-repo there are no readers, so removal is non-breaking locally.
- Decide whether `interop:updatedAt`-style freshness should be provided by the audit mechanism per-update (currently it is only set at creation anyway, so no behavior is lost by removing it).

## Open questions

- Should `setTimestampsAndAgents` be removed only after the generic auditing lands, or can the dead writes be removed first (nothing reads them) with auditing added later? Recommended: remove the writes first — they are dead data and the `updatedAt` value is already misleading; auditing can be adopted independently.
- Should the ACRs (`setAcr` in `crud/agent-registration.ts` and templates) also stop writing agent/client data once auditing exists? Out of scope here — they carry authorization data, not audit metadata — but worth a follow-up discussion.
