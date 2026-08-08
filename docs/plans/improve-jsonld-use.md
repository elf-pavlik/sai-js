# Improve JSON-LD context & framing usage in data-model

> Consolidate the ~15 per-model JSON-LD contexts in `packages/data-model` into a **single shared context** (`dataModelContext`) that serves every model — reads (framing via `frameDoc`) and writes (`withContext`). Remove the duplicated IRI strings (generate terms from the `INTEROP`/`LDP`/`SHAPETREES`/`SKOS`/`RDFS`/`SOLID`/`OIDC` namespaces already exported by `@janeirodigital/interop-utils`), normalize term semantics (`@type: '@id'` coercion, `@container: '@set'`, `@omitDefault`), and settle the term-name collision (`prefLabel` vs `label`).
>
> References: [JSON-LD 1.1](https://www.w3.org/TR/json-ld11/), [JSON-LD 1.1 Framing](https://www.w3.org/TR/json-ld11-framing/).

## How framing works here today

`src/jsonld-utils.ts` is the framing engine:

- `buildFrame(context, iri)` builds a frame from a **context object**: `{ '@context': context, '@id': iri }` plus `frame[key] = { '@embed': '@never' }` for every object-valued context entry (`id`/`type`/`@version` skipped).
- The context does double duty: **expansion of the frame** (terms → IRIs; `@reverse` terms become reverse-property frames) and **compaction of the output** (keys + `@type: '@id'` coercion determine the POJO shape).
- `@embed: '@never'` ⇒ child nodes are never embedded (framing §2.4/§4.1); with `@type: '@id'` coercion, node references compact to plain IRI strings; without it they come out as `{ id }` objects (unwrapped by `framedValue`).
- Reverse relationships (`hasInheritingGrant`, `hasInheritingAuthorization`, `hasInheritingNeed`) are resolved by the framing algorithm via `@reverse` term definitions — no quad lookups.

Spec facts verified (why a big shared context is safe):

- **Frame Matching** (framing §4.2): with `requireAll=false` (default) a node matches if *any* frame property matches; `@id` in the frame forces an id match. A frame built from a big context still matches correctly.
- **Output generation** (framing §4.1): frame properties absent in the node emit `null` unless the property frame has `@omitDefault: true`. jsonld.js honors per-property `@omitDefault` — verified in `node_modules/jsonld/lib/frame.js` (`_getFrameFlag(next, options, 'omitDefault')`, line 284) — so `frame[key] = { '@embed': '@never', '@omitDefault': true }` suppresses the null noise.
- **`@explicit` defaults to false**: node properties not in the frame are still emitted; only context-mapped keys get compacted into POJO keys.
- Fixture documents (`packages/test-utils/src/data.json`) are stored in **expanded form** — framing is format-agnostic, the frame context compacts into POJO keys.

## Duplication inventory

| Term | IRI | Currently in |
|---|---|---|
| `registeredShapeTree` | interop#… | grant, data-authorization, access-need, data-registration |
| `accessMode` | interop#… | grant, data-authorization, access-need |
| `creatorAccessMode`, `hasDataInstance` | interop#… | grant, data-authorization |
| `grantee`/`grantedBy`/`dataOwner`/`hasDataRegistration` | interop#… | grant, data-authorization |
| `prefLabel`/`label` | skos:prefLabel | access-description, shape-tree-description, role, invitation, social-agent-registration (as `label` in the first three, `prefLabel` in the last two) |
| `definition` | skos:definition | access-description, shape-tree-description |
| `hasAccessNeed` | interop#… | access-description (single), access-need-group (`@set`) |
| `hasAccessNeedGroup` | interop#… | access-description, client-id-document, social-agent-registration |
| `registeredAgent` | interop#… | application-registration, invitation, social-agent-registration |
| `hasDataGrant` | interop#… | application-registration, social-agent-registration |
| `note` | skos:note | invitation, social-agent-registration |
| `id`/`type` | @id/@type | every context |
| reverse triplets | interop#inheritsFrom* | grant, data-authorization, access-need |

Plus: the hardcoded interop/shapetrees/skos IRI **strings** in the contexts duplicate the `INTEROP`/`LDP`/`SHAPETREES`/`SKOS`/`RDFS`/`SOLID`/`OIDC` namespaces from `@janeirodigital/interop-utils` used everywhere else in the code (`INTEROP.hasDataRegistration.value` etc.).

## Decisions (settled)

1. **Term names** — `rdfs:label` **is used** (web-id-profile.ts; data-instance fixtures via `describesInstance` → rdfs:label), therefore:
   - `skos:prefLabel` → term **`prefLabel`**
   - `rdfs:label` → term **`label`**
   - POJO renames: `AccessDescriptionData.label` → `prefLabel`, `ShapeTreeDescriptionData.label` → `prefLabel`, `RoleData.label` → `prefLabel`. `WebIdProfileData.label` (rdfs:label) and `DataInstanceData.label` stay.
2. **`hasAccessNeed` container** — unify to `@container: '@set'` in the shared context (array); `access-description.ts` (the only single-value reader) unwraps `[0]`. `hasAccessNeedGroup` is single-valued everywhere → no `@set`.
3. **IRI coercion** — every IRI term gets `@type: '@id'` (currently missing in access-description, client-id-document, web-id-profile `oidcIssuer`) so extraction becomes uniform `node.x ?? fallback` and `framedValue` stays only for literals.
4. **Dynamic contexts stay dynamic** — `data-instance.ts` keeps its per-shape-tree context (spread-override of the shared context).
5. **`@omitDefault: true`** in `buildFrame` per frame property (jsonld.js verified).
6. **PUT payload optimization** — resolved: JSON-LD wire bodies are sent in **expanded form** (no `@context`); see the resolved-notes section. `withContext` remains as the in-memory expansion input.
7. **`linkedIrisJsonLd`** — resolved (Option A: frames with the shared context, term-name argument); see the resolved-notes section.

## Phase 1 — new `src/context.ts` (single source of truth)

One exported `dataModelContext` with every term used by every model, generated from the namespaces to kill the duplicated IRI strings:

```ts
const iriTermDef = (ns, name, { set = false } = {}) =>
  ({ '@id': ns[name].value, '@type': '@id', ...(set ? { '@container': '@set' } : {}) })

// iriTermDef returns a JSON-LD term definition (the value object in a context
// map) with IRI coercion (`@type: '@id'`): values compact to plain IRI strings
// in framed output. `set: true` adds `@container: '@set'` (always-array).
// `@reverse` terms and literal terms (no coercion) stay explicit object
// literals, e.g. `label: { '@id': RDFS.label.value }`.
```

Final term inventory (term → IRI, coercion):

**interop** — `grantee`, `grantedBy`, `dataOwner`, `registeredShapeTree`, `hasDataRegistration`, `hasStorage`, `scopeOfGrant`; `scopeOfAuthorization`, `satisfiesAccessNeed`; `inheritsFromGrant`, `delegationOfGrant`, `hasInheritingGrant` (`@reverse` inheritsFromGrant, `@set`); `inheritsFromAuthorization`, `hasInheritingAuthorization` (`@reverse`, `@set`); `accessMode`, `creatorAccessMode`, `hasDataInstance` (all `@set`); `inheritsFromNeed`, `hasInheritingNeed` (`@reverse`, `@set`); `required` → interop:accessNecessity; `hasAccessNeed` (`@set`), `hasAccessNeedGroup`; `capabilityUrl` → interop:hasCapabilityUrl; `registeredAgent`; `hasDataGrant` (`@set`); `members` → interop:hasMember (`@set`); `reciprocalRegistration`; `hasAgentRegistry`, `hasAuthorizationRegistry`, `hasGrantRegistry`, `hasRoleRegistry`, `hasDataRegistry` (`@set`); `callbackEndpoint` → interop:hasAuthorizationCallbackEndpoint.

**ldp** — `contains` (`@set`).

**shapetrees** — `shape`, `describesInstance`, `expectsType`, `hasShapeTree`, `viaPredicate`; `references` (`@set`, no `@type` — node objects); `descriptionLanguages` → shapetrees:usesLanguage (`@set`, literal).

**skos** — `prefLabel`, `definition`, `note` (literals).

**rdfs** — `label`.

**solid/terms** — `oidcIssuer`.

**solid/oidc** — `clientName` → oidc:client_name, `logoUri` → oidc:logo_uri (literals).

**nfo** — `fileName` (local `buildNamespace` in context.ts, same pattern as data-instance today).

`id: '@id'`, `type: '@type'` on top. No `@version: 1.1` needed (all features used are 1.0) and **no `@protected`** (we must keep the ability to spread-override `label` per model).

## Phase 2 — swap per-model contexts for the shared one

| Module | Current context | Change |
|---|---|---|
| `grant.ts` | `grant-context.ts` | use `dataModelContext`; delete `grant-context.ts` |
| `data-authorization.ts` | `data-authorization-context.ts` | use `dataModelContext`; delete `data-authorization-context.ts` |
| `data-registration.ts` | inline | use `dataModelContext` |
| `access-need.ts` | inline | use `dataModelContext` |
| `access-need-group.ts` | inline | use `dataModelContext` |
| `access-description.ts` | inline | use `dataModelContext`; term `label`→`prefLabel`; unwrap `hasAccessNeed` |
| `application-registration.ts` | inline | use `dataModelContext` |
| `client-id-document.ts` | inline | use `dataModelContext` |
| `shape-tree.ts` | inline | use `dataModelContext` (write path) |
| `shape-tree-description.ts` | inline | use `dataModelContext`; term `label`→`prefLabel` |
| `web-id-profile.ts` | inline | use `dataModelContext` — `label` = rdfs:label already matches, no override needed |
| `crud/role.ts` | inline | use `dataModelContext`; term `label`→`prefLabel` |
| `crud/social-agent-invitation.ts` | inline | use `dataModelContext` |
| `crud/social-agent-registration.ts` | inline | use `dataModelContext` |
| `crud/registry-set.ts` | inline | use `dataModelContext` |
| `data-instance.ts` | dynamic | `{ ...dataModelContext, label: describesInstance…, fileName, [viaPredicate]: … }` (override stays) |

## Phase 3 — extraction cleanup (read paths)

- **access-description.ts**: `framedValue(node.label)` → `framedValue(node.prefLabel)`; `framedValue(node.hasAccessNeed)!` → `(node.hasAccessNeed ?? [])[0]`; drop `framedValue` for `hasAccessNeedGroup` (now `@type: '@id'`).
- **client-id-document.ts**: `callbackEndpoint`/`hasAccessNeedGroup` → `node.x ?? undefined` (drop `framedValue`).
- **web-id-profile.ts**: `oidcIssuer` → `node.oidcIssuer ?? undefined` (drop `framedValue`).
- **role.ts / shape-tree-description.ts**: `node.label` → `node.prefLabel`.
- `framedValue` stays for literals only (`prefLabel`, `definition`, `note`, `clientName`, `logoUri`, `label` in data-instance/webid).
- The `?? undefined` null-normalizations (e.g. social-agent-invitation comment) become no-ops once `@omitDefault` lands — harmless, can stay or be simplified.

## Phase 4 — `buildFrame` gains `@omitDefault`

`buildFrame`: `frame[key] = { '@embed': '@never', '@omitDefault': true }`. Behavior change: framed-but-absent properties no longer emit `null` (they are omitted). Extraction already tolerates both (`?? fallback`). No other jsonld-utils changes; `frameDoc`/`frameDataset`/`withContext`/`toStore` signatures unchanged.

## Phase 5 — public API

- `src/index.ts` previously exported `grantContext` and `dataAuthorizationContext`; `packages/authorization-agent/src/authorization.ts` imported `dataAuthorizationContext` for its write (`withContext` + `putJsonLd`).
- Option B (**chosen**): drop the legacy aliases entirely — `index.ts` exports only `dataModelContext` (+ `iriTermDef`); `authorization-agent` updated to import `dataModelContext` directly. Breaking change, but the alias names were only ever used by that one consumer.

## Phase 6 — consumers of renamed POJO fields (`label` → `prefLabel`)

- `packages/components/src/services/Authorization.ts` — lines ~46 (`description.label`), ~52 (`shapeTreeDescription.label`), ~218 (`descriptions.label`).
- `packages/components/src/services/ShareResource.ts` — ~26 (`shapeTreeDescription?.label`).
- `packages/components/src/services/DataRegistry.ts` — ~30, ~61 (`shapeTreeDescription?.label`).
- `packages/components/src/services/RoleRegistry.ts` — `getRoles` (`registration.label`).
- Unaffected: `AgentRegistry.ts` `profile.label` (webid rdfs:label) and `dataInstance.label`.

## Phase 7 — tests

- Run the full data-model suite (`test/readable/*`, `test/pojo/*`, `test/crud/*`) — fixtures are expanded-form, framing is format-agnostic.
- Round-trip checks already exist for grant/data-authorization (`toJsonLd` → `toStore` → quad assertions); extend the same pattern to a representative from each module.
- Add a regression test asserting **no `null` keys** in framed output (verifies `@omitDefault`).
- Add a compaction-ambiguity guard: assert `prefLabel` (skos) and `label` (rdfs) compact to their own keys in the same framed document.
- Typecheck/build across packages (authorization-agent, components).

## Deferred / TBD

- **`@version: 1.1` / `@protected` / scoped contexts** — not needed for the current feature set; revisit if 1.1-only features (e.g. type-scoped contexts for shape-tree `references`) are wanted.

## Resolved during implementation: expanded JSON-LD on the write path

The PUT payload optimization is resolved differently than originally sketched: instead of *filtering* the context to used terms, the JSON-LD wire bodies are now sent in **expanded form** — no `@context` at all (context is only used to expand in memory):

```ts
// jsonld-utils.ts
export async function expandedJsonLd(doc: Record<string, unknown>): Promise<unknown[]> {
  return jsonld.expand(doc, { documentLoader })
}

// putJsonLd serializes the expanded form, so every raw JSON-LD PUT is context-free
const response = await fetch(iri, { method: 'PUT', body: JSON.stringify(await expandedJsonLd(doc)), … })
```

Measured effect: a 3-quad role PUT went from **5,166 B** (compacted + full embedded `dataModelContext`) to **241 B**. A role wire body is now `[{ "@id": …, "…interop#hasMember": [{ "@id": … }], "…skos#prefLabel": [{ "@value": … }], "@type": ["…interop#Role"] }]`.

Scope of the change:
- **`putJsonLd`** expands internally — covers role, social-agent-invitation, and authorization-agent data-authorization PUTs (unchanged call sites).
- **`components/temporal/activities/grants.ts`** `storeDataGrant` now sends `expandedJsonLd(toJsonLd(payload))`.
- The **container/registration write paths** (`toStore` → `createContainer`) are unaffected: they never send JSON-LD on the wire (empty-container PUT + SPARQL-patch description resource, turtle).
- `toJsonLd` functions keep returning the compacted-with-context form (used for `toStore` quad checks, shape-tree container path, and as the expansion input).

Rationale: expanded form is RDF-identical (verified: same quads from `toStore`), the canonical JSON-LD processing form (spec-safe), self-describing/context-version-proof, and it removes more complexity than it adds (no context construction on the wire). Cost: full-IRI bodies are less pleasant to eyeball in raw storage.

## Resolved during implementation: `linkedIrisJsonLd` consolidation (Option A)

`linkedIrisJsonLd` no longer builds a per-call ad-hoc context (`{ id, items: { @id: property, … } }`). It now frames with `dataModelContext` and takes a **term name** instead of a property IRI:

```ts
export async function linkedIrisJsonLd(iri: string, fetch: WhatwgFetch, term: string): Promise<string[]> {
  const node = (await frameDoc(await fetchJsonLd(iri, fetch), dataModelContext, iri)) as any
  return node[term] ?? []
}
```

Three interop terms were added to `dataModelContext` to cover all callers (`hasApplicationRegistration`, `hasSocialAgentRegistration`, `hasSocialAgentInvitation` — registry scans; `contains` and `hasDataRegistration` already existed). Callers updated in `agent-registry`, `data-registry`, `authorization-registry`, `role-registry` (`LDP`/`INTEROP` imports trimmed where they became unused). The last ad-hoc context is gone — the shared context is the single source of truth for reads and writes.

## Implementation notes (deviations found while implementing)

Two edge cases surfaced during implementation and were resolved without changing the plan's architecture:

- **data-instance `label` leak** — spreading `dataModelContext` brings in `label` → `rdfs:label` unconditionally. Instance documents that carry an `rdfs:label` (the describesInstance target of most trees) would gain a label even when the tree does **not** declare `describesInstance` (regression: `dataInstance.label` became `"P-Ap-2"` where it used to be `undefined`). Fix: `dataInstanceContext` deletes `label` from the spread when `shapeTree.describesInstance` is absent (old semantics preserved exactly).
- **compacted client-id documents** — real client id documents are compacted JSON-LD where the OIDC context does **not** type IRI-valued properties (`interop:hasAccessNeedGroup`, `interop:hasAuthorizationCallbackEndpoint`), so their string values expand to *literals*. Framing output compaction refuses to compact a literal under a `@type: '@id'` term → the value lands on the raw IRI key instead of the term key. Fix: `client-id-document.ts` extraction falls back to the namespace-derived IRI key (`node.callbackEndpoint ?? node[INTEROP.hasAuthorizationCallbackEndpoint.value]`). All other models read expanded-form documents (node references) and are unaffected. (`expandContext` was tried first — jsonld.js ignores it when the document carries its own `@context`.)

## Risks

- **Compaction ambiguity** (`prefLabel` vs `label` mapping to the same IRI) — resolved by the term-name decision (1); must not reintroduce two terms for one IRI.
- **`@set` on `hasAccessNeed`** changes the read shape of access-description (`[iri]` instead of `iri`) — the `[0]` unwrap is required.
- **`@omitDefault`** changes framed output shape (no nulls) — extraction is null-tolerant, but tests/consumers must not depend on null keys.
- **Shared context in write payloads** — resolved: JSON-LD PUT bodies are expanded (no context on the wire); the full shared context survives only in-memory as the expansion input.
- **Public API renames** (`AccessDescriptionData.label`, `ShapeTreeDescriptionData.label`, `RoleData.label`) — coordinated across data-model, components (Phase 6); `api-messages` UI types are separate and unaffected.
