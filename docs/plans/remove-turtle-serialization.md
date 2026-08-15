# Remove Turtle serialization — drop `parseTurtle` and `serializeTurtle`

> **Goal.** Delete `packages/utils/src/turtle-parser.ts` (`parseTurtle`) and — after the write path is converted — `packages/utils/src/turtle-serializer.ts` (`serializeTurtle`) entirely. After this plan the codebase is JSON-LD-first on both sides of the wire:
>
> - **Reads** already go through `parseJsonld` / `fetchJsonLd` / `toStore` — all backed by `jsonld.toRDF`.
> - **Writes** go through a new `toNQuads` helper — `jsonld.toRDF(doc, { format: 'application/n-quads' })` — producing N-Triples (all our patch datasets are default-graph, so N-Quads degenerates to N-Triples, which is valid Turtle) for SPARQL `INSERT/DELETE DATA { … }` bodies.
> - The only remaining Turtle on the wire is the two ACR writes — `setAcr` (`agent-registration.ts`, a template→parse→serialize no-op round trip → write the template string directly, Phase 2) and the data-grant ACR PUT in `components/src/temporal/activities/grants.ts:420-429` (already writes `dataGrantTemplate(...)` directly, no parse/serialize — left as-is).
> - **CSS notification streams** switch to a custom streaming HTTP emitter (in `@elfpavlik/sai-components`) that writes **NDJSON of expanded JSON-LD notifications** instead of Turtle chunks (§Phase 3).
>
> **Why now.** Survey of every call site (below) shows the Turtle helpers are thin wrappers around N3 (`n3` `Parser`/`Writer`) used in exactly three production shapes:
>
> 1. **The SPARQL patch path** — `serializeTurtle` is embedded in `insertPatch`/`deletePatch` (`packages/utils/src/sparql-update.ts`), which feeds `applyPatch` (`Content-Type: application/sparql-update`) in `container.ts`, `agent-registration.ts`, and `activity-registry.ts`. Every dataset/quad in this path is **default-graph** (verified: all quads come from 3-arg `DataFactory.quad(s, p, o)` or `toStore` of flat JSON-LD docs). So the patch body can be produced directly from a JSON-LD doc via `jsonld.toRDF(..., { format: 'application/n-quads' })` — no `Store`, no N3 `Writer`.
> 2. **The ACR template PUT** — `setAcr` parses a Turtle template string only to re-serialize it back to Turtle and PUT it. A no-op round trip.
> 3. **CSS notification streams** — `notification-manager.ts` and `test/util.ts` parse stream payloads as Turtle. Stock CSS `8.0.0-alpha.2` **hardcodes Turtle server-side** (`generateChannel` in `StreamingHttp2023Util.js` sets `accept: 'text/turtle'`; the client's `Accept` header is ignored), so requesting `application/ld+json` is not enough. Instead: a custom streaming HTTP emitter (in `@elfpavlik/sai-components`, the existing custom-CSS-components package) that streams **NDJSON of expanded JSON-LD notifications**; the clients read NDJSON and parse each line with `parseJsonld`/`toStore` (expanded docs need no context resolution).
>
> **Phase structure:**
> 0. ⬜ **done?** — Add `toNQuads(doc, base?)` to `packages/utils/src/jsonld.ts` (wraps `jsonld.toRDF(doc, { format: 'application/n-quads' })`) with pinning unit tests (default graph → N-Triples, no graph labels, literal coercion semantics)
> 1. ⬜ **done?** — Convert the SPARQL patch path: `insertPatch`/`deletePatch` accept a JSON-LD doc; `container.ts` helpers (`addStatement`/`removeStatement`/`replaceStatement`/`createContainer`) and crud modules build `withContext(dataModelContext, …)` docs instead of `DataFactory.quad` stores; update tests
> 2. ⬜ **done?** — `setAcr` writes the ACR template string directly (drop the `parseTurtle`→`serializeTurtle` round trip)
> 3. ⬜ **done?** — Custom CSS streaming HTTP emitter (`@elfpavlik/sai-components`): channel `accept` → `application/x-ndjson`, serializer emits expanded JSON-LD + `\n` per notification, emitter guarantees NDJSON framing; clients (`notification-manager.ts`, `test/util.ts`) read NDJSON and parse with `parseJsonld`/`toStore`
> 4. ⬜ **done?** — Delete `turtle-parser.ts`, `turtle-serializer.ts`, `turtle-parser.test.ts`; remove the exports from `packages/utils/src/index.ts`; update the remaining tests that used them for fixtures
>
> **Each phase ends green**: after every phase `npm run build` (turbo) + `npm test` (turbo, packages) must pass. Phases are ordered so the tests that pin a behavior change are added *before* the change that would break them. The `test/` integration workspace (dagger-only, §Verification) is verified by `tsc --noEmit` locally and the dagger suite as final gate.

---

## Current state (surveyed)

### `parseTurtle` — `packages/utils/src/turtle-parser.ts`

Exported from `packages/utils/src/index.ts:1` (`export * from './turtle-parser'`). Wraps N3 `Parser` + `Store`, forces the default graph, resolves via Promise.

| Consumer | Kind | Site | Notes |
|---|---|---|---|
| `data-model/src/crud/agent-registration.ts` | production | `setAcr` (import :6, call :65) | parses `agentRegistrationAcrTemplate(...)` (Turtle string) then immediately re-serializes with `serializeTurtle` and PUTs `text/turtle` (:74) — **no-op round trip** |
| `application/src/notification-manager.ts` | production | `handleStream` (import :7, call :89) | parses CSS notification stream payload; fetch to `receiveFrom` sets **no Accept header** → CSS defaults to Turtle |
| `test/util.ts` (root, dagger-only) | production (test infra) | `awaitNotification` (import :5, call :64) | same shape as notification-manager (already TODO-noted as duplicated) |
| `data-model/test/application-factory.test.ts` | test | :3, :31 | parses an invalid-grant Turtle snippet |
| `utils/test/turtle-parser.test.ts` | test | whole file (7 tests) | dedicated suite — deleted with the parser |
| `utils/test/turtle-serializer-test.ts` | test | :3, :14 | fixture construction |
| `utils/test/match.test.ts` | test | :4, :23 | fixture construction |
| `utils/test/sparql-update.test.ts` | test | :2, :18, :25 | fixture construction |

### `serializeTurtle` — `packages/utils/src/turtle-serializer.ts`

Exported from `packages/utils/src/index.ts:4`. Wraps N3 `Writer` (`format: 'text/turtle'`), optional `trim` (named-graph → TriG).

| Consumer | Kind | Site | Notes |
|---|---|---|---|
| `utils/src/sparql-update.ts` | production | :2, :5, :9 | `insertPatch`/`deletePatch` embed `serializeTurtle(dataset)` in `INSERT DATA { … }` / `DELETE DATA { … }` |
| `data-model/src/crud/agent-registration.ts` | production | `setAcr` (:7, :74) | PUT body — eliminated by Phase 2 (write template directly) |
| `data-model/src/crud/container.ts` | transitive | `applyPatch` (:34-45, `application/sparql-update`), `addStatement` (:58), `removeStatement` (:67), `replaceStatement` (:78-79), `createContainer` (:104) | via `insertPatch`/`deletePatch` |
| `data-model/src/crud/agent-registration.ts` | transitive | `replaceDataGrants` (:158-159) | via `insertPatch`/`deletePatch` |
| `data-model/src/crud/activity-registry.ts` | transitive | `updateActivityStatus` (:128, :133) | via `insertPatch`/`deletePatch` |
| `utils/test/turtle-serializer-test.ts`, `utils/test/sparql-update.test.ts`, `data-model/test/crud/container.test.ts` | test | — | assert patch strings / round trips |

**Key facts:**
- Every dataset reaching `insertPatch`/`deletePatch` is **default-graph only**: `addStatement`/`removeStatement`/`replaceStatement` build `new Store([quad])` from 3-arg `DataFactory.quad` calls (callers: `agent-registry.ts:133,167,201`, `data-registry.ts:84`, `social-agent-registration.ts:151-199`, `agent-registration.ts:106,120`); `createContainer` datasets come from `new Store()` + default-graph quads (`grant-registry.ts:22-24`, `role-registry.ts:79-81`, `data-registry.ts:101-103`, `agent-registry.ts:214-216`, `activity-registry.ts:54-56`, `authorization-registry.ts:98-100`) or `toStore(withContext(...))` of flat JSON-LD docs (`data-registration.ts:68`, `application-registration.ts:82`). N-Quads from `toRDF` therefore has no graph labels = N-Triples = valid Turtle = valid in SPARQL data blocks.
- The whole-resource write path **already builds JSON-LD docs** (`withContext(dataModelContext, data)` → `toStore`): `data-registration.ts:64-68`, `application-registration.ts:79-82`. Phase 1 removes the intermediate `Store` there too (pass the doc straight to `createContainer`).
- `dataModelContext` (`packages/data-model/src/context.ts`) already defines every predicate used by hand-built quads: `registeredAgent`, `hasDataGrant` (`@set`), `hasApplicationRegistration` (`@set`), `hasSocialAgentRegistration` (`@set`), `status`, `prefLabel`, `note`, plus `id`/`type` (`@id`/`@type`). No context changes needed.
- `parseJsonld` (`packages/utils/src/jsonld-parser.ts`) already wraps `jsonld.toRDF` and its `localDocumentLoader` ships the solid notifications context (`https://www.w3.org/ns/solid/notifications-context/v1`) — the JSON-LD read side is ready.

**Dependency note:** `n3` stays a dependency regardless — `parseJsonld` and `toStore` collect quads into an N3 `Store`, and `match.ts` operates on datasets. Only the N3 `Parser`/`Writer` usage in the Turtle helpers goes away.

---

## Phase 0 — Add `toNQuads` helper (+ pinning tests)

New export in **`packages/utils/src/jsonld.ts`**:

```ts
/**
 * Serialize a JSON-LD document (with embedded context) to N-Quads text via
 * jsonld.toRDF. For default-graph documents the output is N-Triples (valid
 * Turtle), suitable as a SPARQL INSERT/DELETE DATA block body.
 */
export async function toNQuads(doc: Record<string, unknown>, base?: string): Promise<string> {
  return jsonld.toRDF(doc, { format: 'application/n-quads', base, documentLoader })
}
```

Pinning tests (new `packages/utils/test/to-nquads.test.ts`):
- flat doc → pure N-Triples: every line `<s> <p> <o> .` with **no 4th term** (assert with a regex / by round-tripping through N3 `Parser` and checking all `graph.termType === 'DefaultGraph'`)
- plain string literal stays `"plain"` (no `xsd:string` datatype in output)
- JS number → `"42"^^xsd:integer`; JS boolean → `"true"^^xsd:boolean` (document the coercion)
- IRI-valued term needs `@type: '@id'` in the context (documents the `dataModelContext` requirement)
- empty doc (no properties) → `''` → `DELETE DATA {  }` is valid
- base IRI resolution for relative IRIs

**Done when:** `toNQuads` is exported, tests pass, nothing consumes it yet.

---

## Phase 1 — Convert the SPARQL patch path to JSON-LD docs

### 1a. `packages/utils/src/sparql-update.ts`

Change `insertPatch`/`deletePatch` to accept a JSON-LD doc instead of `DatasetCore`:

```ts
export async function insertPatch(doc: Record<string, unknown>, base?: string): Promise<string> {
  return `INSERT DATA { ${await toNQuads(doc, base)} }`
}
export async function deletePatch(doc: Record<string, unknown>, base?: string): Promise<string> {
  return `DELETE DATA { ${await toNQuads(doc, base)} }`
}
```

(Breaking change to the published `@janeirodigital/interop-utils` API — **accepted** (see Open questions); doc-only signature, no `DatasetCore` overload. Every caller converts in 1b/1c.)

### 1b. `packages/data-model/src/crud/container.ts`

- `addStatement(iri, factory, doc)` / `removeStatement(iri, factory, doc)` / `replaceStatement(iri, factory, whichDoc, withDoc)` — take `withContext(dataModelContext, …)` docs instead of `Quad`s; drop the `new Store([quad])` construction.
- `createContainer(iri, factory, doc)` — takes the doc; callers pass `withContext(dataModelContext, data)` **directly** (removes the intermediate `toStore` in `data-registration.ts:68` and `application-registration.ts:82`).
- `applyPatch` is unchanged — still the SPARQL `PATCH` transport (`Content-Type: application/sparql-update`, description resource via HEAD + Link).

### 1c. crud modules — replace `DataFactory.quad` with docs

| Module (site) | Current | Doc |
|---|---|---|
| `agent-registration.ts` `toDataset` (:35-48) | `Store` + quads for `registeredAgent`/`hasDataGrant` | `withContext(dataModelContext, { '@id': data.id, registeredAgent, hasDataGrant })` |
| `agent-registration.ts` `addDataGrant`/`removeDataGrant`/`replaceDataGrants` (:101, :115, :152-159) | `DataFactory.quad(…, hasDataGrant, …)` + `new Store` | doc `{ '@id': id, hasDataGrant: iri }` / `{ '@id': id, hasDataGrant: [...] }` (empty set → key omitted → `DELETE DATA {  }`) |
| registry type quads — `grant-registry.ts:22-24`, `role-registry.ts:79-81`, `data-registry.ts:101-103`, `agent-registry.ts:214-216`, `activity-registry.ts:54-56`, `authorization-registry.ts:98-100` | `quad(namedNode(id), RDF.type, INTEROP.terms.XRegistry)` | `{ '@id': id, type: INTEROP.terms.XRegistry }` — `@type` values are full IRIs (no `@vocab` in `dataModelContext`) |
| link statements — `agent-registry.ts:133,167,201` (`hasApplicationRegistration`), `data-registry.ts:84`, `social-agent-registration.ts:151-199` | quads | `{ '@id': id, hasApplicationRegistration: iri }` etc. |
| `social-agent-registration.ts:100-106` | `prefLabel`/`note` literals | `{ '@id': node, prefLabel, note }` (plain literal terms) |
| `activity-registry.ts:128-134` `updateActivityStatus` | delete old `status` literal + insert new | docs `{ '@id': iri, status }` for both (prior value read via `loadActivity`, same as today) |

`removeStatement`/`replaceStatement` still need the **exact prior quad** — callers already track `priorQuad` (`social-agent-registration.ts:157,192`); they track the prior *doc* instead. Resulting quad is identical (default graph; plain literals get `xsd:string` under RDFJS, matching N3 `DataFactory.literal`).

### 1d. tests

- `packages/utils/test/sparql-update.test.ts` — build expected patch strings via `toNQuads` (or assert round-trip: parse the body's data block back and compare quads).
- `packages/data-model/test/crud/container.test.ts` — update `insertPatch`/`deletePatch` call shape.
- data-model crud tests that assert patched stores — unchanged (they assert server-side effects, not bodies).

**Done when:** no `DataFactory.quad` / `Store` construction remains in `packages/data-model/src/crud/*`; `serializeTurtle` has exactly one production consumer left (`setAcr`).

---

## Phase 2 — `setAcr` writes the template directly

`packages/data-model/src/crud/agent-registration.ts` `setAcr` (:65-74) currently:

```ts
const dataset = await parseTurtle(agentRegistrationAcrTemplate({ id, owner, peer }))
const response = await factory.fetch(acrLocation, {
  method: 'PUT',
  body: await serializeTurtle(dataset),
  headers: { 'Content-Type': 'text/turtle' },
})
```

The template is already a Turtle string, so:

```ts
const response = await factory.fetch(acrLocation, {
  method: 'PUT',
  body: agentRegistrationAcrTemplate({ id, owner, peer }),
  headers: { 'Content-Type': 'text/turtle' },
})
```

(If a JSON-LD ACR write is ever wanted instead, `jsonld.fromRDF` + `application/ld+json` — but that's out of scope; the template stays Turtle on the wire.)

**Done when:** `parseTurtle` and `serializeTurtle` have **zero production consumers**; `turtle-serializer.ts` remains only as a library export + its own tests.

---

## Phase 3 — Custom CSS streaming HTTP emitter: NDJSON of expanded JSON-LD notifications

### Server research (CSS `8.0.0-alpha.2`, `@solid/community-server`)

The streaming pipeline and where Turtle is baked in:

| Piece | File (dist) | Turtle hardcoding |
|---|---|---|
| Channel generation | `server/notifications/StreamingHttpChannel2023/StreamingHttp2023Util.js` | **`generateChannel(topic)` returns `accept: 'text/turtle'`** — the single lever; a plain exported function, called from the two classes below |
| receiveFrom endpoint | `…/StreamingHttpRequestHandler.js` | sends the **initial notification** through generator+serializer, sets response `Content-Type` to `channel.accept`, **ignores the client's `Accept` header** |
| Activity listener | `…/StreamingHttpListeningActivityHandler.js` | calls `generateChannel(topic)` per event, then the notification handler chain |
| Serializer chain | `notifications/serialize/ConvertingNotificationSerializer.js` + `JsonLdNotificationSerializer.js` | source serializer **already emits JSON-LD** (`JSON.stringify(notification)`); `ConvertingNotificationSerializer` converts to `channel.accept` via the RepresentationConverter |
| Emitter | `…/StreamingHttp2023Emitter.js` | reads each serialized notification to a string and writes it as a **single chunk** per stream — already correct for NDJSON line framing |

Key facts:
- The `Notification` object is **compacted JSON-LD** (`{ '@context': [activitystreams, notification/v1], id, type, object, state?, target?, published }`, e.g. from `ActivityNotificationGenerator.js`). **Expanded** form drops `@context` and uses full IRIs — parseable client-side with no context resolution.
- **Local context inventory** (`packages/utils/src/jsonld-parser.ts` `localContexts`): only `oidc-context.jsonld` and `notifications-context/v1` (the **channel/subscription** context, used by `subscribeViaPush`/`AgentIdHandler`). The notification-**object** contexts — `https://www.w3.org/ns/solid/notification/v1` and `https://www.w3.org/ns/activitystreams` — are **absent**; `localDocumentLoader` would fall through to network `fetch` for them.
- `https://www.w3.org/ns/solid/notification/v1` is **not resolvable publicly** (404 at `w3.org`, `solidproject.org`, `w3id.org`, GitHub raw — verified) — it exists only as the `CONTEXT_NOTIFICATION` constant in CSS source. **However, CSS vendors both notification contexts locally**: `@solid/community-server/templates/contexts/{notification,activitystreams}.jsonld`, mapped in `config/util/representation-conversion/converters/rdf-to-quad.json` (`https://www.w3.org/ns/solid/notification/v1` → `@css:templates/contexts/notification.jsonld`, `https://www.w3.org/ns/activitystreams` → `@css:templates/contexts/activitystreams.jsonld`). This is exactly how the stock Turtle stream works today (JSON-LD → RdfToQuadConverter with these contexts → quad-to-Turtle), and it pins the expanded-form IRIs (see 3a.2).
- All pieces are Components.js components wired in `config/http/notifications/{base,streaming-http}/*.json` (`urn:solid-server:default:StreamingHttp2023Emitter`, `BaseNotificationSerializer`, `StreamingHttp2023RequestHandler`, `StreamingHttpListeningActivityHandler`).
- `@elfpavlik/sai-components` is the established custom-components package for this CSS deployment (external npm dep, imported via `sai:config/registry.json`; ships `dist/components/components.jsonld` via `componentsjs-generator`) — the natural home for the custom emitter.

### 3a. Server: custom components (in `@elfpavlik/sai-components`)

1. **Channel generation override.** Replace the two classes that call the hardcoded `generateChannel`:
   - subclass/reimplement `StreamingHttpRequestHandler` and `StreamingHttpListeningActivityHandler` (or extract a shared channel factory) so the channel is `{ … , accept: 'application/x-ndjson' }`.
   - **Optional superset:** negotiate from the request's `Accept` header (`application/x-ndjson` → NDJSON; `text/turtle` → Turtle) so existing Turtle consumers keep working. If skipped, the format is server-fixed to NDJSON.
2. **Serializer: expanded JSON-LD + `\n`.** New `NotificationSerializer`:
   - **required (not just preferred):** construct the expanded form **directly** — no context resolution, deterministic; `jsonld.expand` is not viable (`notification/v1` 404s publicly). **The IRIs are pinned from CSS's own vendored contexts** (`templates/contexts/{notification,activitystreams}.jsonld`, see research): `id` → `@id`; `type` → `@type` = `https://www.w3.org/ns/activitystreams#<Type>`; `object`/`target` → `https://www.w3.org/ns/activitystreams#{object,target}` as `{ '@id' }`; `published` → `https://www.w3.org/ns/activitystreams#published` as `{ '@type': xsd:dateTime, '@value' }`; `state` → `http://www.w3.org/ns/solid/notifications#state` as `{ '@value' }` (same IRI the client's local `notifications-context/v1` already maps).
   - output `Content-Type: application/x-ndjson`; **bypass `ConvertingNotificationSerializer`** (its RepresentationConverter has no NDJSON target — wire the custom serializer directly, or make `accept` skip conversion).
3. **Emitter: NDJSON framing.** New `StreamingHttp2023Emitter` subclass: guarantees exactly one JSON object per line (explicit `\n` terminator), sets `Content-Type: application/x-ndjson` on the streams, optional heartbeat. (The stock emitter already writes whole chunks — the serializer newline plus a thin emitter is sufficient.)
4. **Config.** Components.js config in `sai-components` overriding `urn:solid-server:default:StreamingHttp2023Emitter`, `BaseNotificationSerializer`, `StreamingHttp2023RequestHandler`, `StreamingHttpListeningActivityHandler` (or a full streaming-http override that imports + overrides the base pieces).

### 3b. Client: NDJSON reader (fixes the multi-chunk bug)

`packages/application/src/notification-manager.ts` `handleStream` (:89) and `test/util.ts` `awaitNotification` (:64):

```ts
// buffer chunks, split on newlines, JSON.parse per line (expanded JSON-LD)
// each line: { '@id', '@type': [as:Type], 'as:object': { '@id' }, … }
const doc = JSON.parse(line)
const dataset = await toStore(doc) // or parseJsonld(JSON.stringify(doc)) — no context resolution needed
const type = getOneMatchingQuad(dataset, null, RDF.terms.type)!.object.value
const object = getOneMatchingQuad(dataset, null, AS.terms.object)!.object.value
```

NDJSON forces buffering across chunk boundaries — the per-chunk `TextDecoder` decode in both files is a latent multi-chunk bug today; this fixes it as a side effect. (Dedupe the duplicated stream logic TODO between the two files while here.)

**Verification:** run services/css with the custom components, subscribe to a resource, assert the stream is `application/x-ndjson` with one expanded JSON-LD object per line; `test/policy-engine.test.ts` (dagger) exercises `awaitNotification` end-to-end.

**Done when:** neither `notification-manager.ts` nor `test/util.ts` imports `parseTurtle`; the CSS deployment streams NDJSON expanded JSON-LD.

---

## Phase 4 — Delete the Turtle helpers

1. Delete `packages/utils/src/turtle-parser.ts` and `packages/utils/src/turtle-serializer.ts`.
2. Remove `export * from './turtle-parser'` (index.ts:1) and `export * from './turtle-serializer'` (index.ts:4).
3. Delete `packages/utils/test/turtle-parser.test.ts`.
4. Update remaining fixture construction that used `parseTurtle`:
   - `packages/utils/test/turtle-serializer-test.ts` — **deleted** with the serializer (Phase 2 removes its production consumer; if the file outlives it, rewrite fixtures via `toNQuads` round-trip or direct `Store` + `DataFactory.quad`).
   - `packages/utils/test/match.test.ts` — fixtures via `parseJsonld` or direct `Store` + `DataFactory.quad`.
   - `packages/data-model/test/application-factory.test.ts` — `parseJsonld(JSON.stringify(...))` or direct Store.
5. Grep for stragglers: `rg -n "parseTurtle|serializeTurtle" --glob '!**/node_modules/**'` should only hit docs.

**Done when:** both files and their exports are gone; full build + test pass.

## Open questions / decisions

1. ✅ **decided — breaking API change accepted (Phase 1a).** `insertPatch`/`deletePatch` change from `DatasetCore` to a JSON-LD doc; no overload kept. In-repo `test/` and `examples/vuejectron` pin published `1.0.0-rc.26` — unaffected until the next publish; bump the package version with the change.
2. **Data-grant ACR Turtle write (`grants.ts:420-429`).** A 4th Turtle-on-the-wire site, already template-direct (no parse/serialize) — stays as-is; the Goal text above acknowledges it.
3. **Phase 3a.1 strategy.** `generateChannel` is called inline inside both handlers' `handle()` methods, so "subclass" means overriding `handle` wholesale (≈70 lines incl. auth). Decide: reimplement the two thin classes in `sai-components` (recommended) vs subclass. Also decide content negotiation (serve `application/x-ndjson` always vs negotiate from the client's `Accept` header).
4. **Generator output-shape variance (3a.2).** Direct construction assumes `{id, type, object, state?, published}` from `ActivityNotificationGenerator`; verify the shapes of `AddRemoveNotificationGenerator`, `DeleteNotificationGenerator`, and the **initial** notification (`StateNotificationGenerator`, sent through the same serializer by `StreamingHttpRequestHandler`) — handle optional `target`/missing `state` before writing the serializer.

---

## Verification

- Per phase: `npm run build` (turbo) + `npm test` (turbo, packages) green.
- Phase 3 server check: run services/css with the custom `@elfpavlik/sai-components` emitter, subscribe to a resource, assert the stream is `application/x-ndjson` and every line is a self-contained expanded JSON-LD notification (initial notification + one per change) before flipping `notification-manager.ts` and `test/util.ts`.
- Phase 3 client check: buffered NDJSON reader handles notifications split across chunk boundaries (the current per-chunk `TextDecoder` decode cannot).
- Final gate: `test/` integration workspace (dagger) — notification-driven tests (`test/policy-engine.test.ts` uses `receivesNotification`/`awaitNotification` via `test/util.ts`) must pass with the NDJSON stream.
- Wire-format sanity: SPARQL patch bodies are N-Triples (N-Quads without graph labels) — Oxigraph/CSS parse them as Turtle data blocks; the `application/sparql-update` mapping (`environments/css/oxigraph.nginx.conf`, `nix/images/sai-oxigraph.nix`) is unchanged.
