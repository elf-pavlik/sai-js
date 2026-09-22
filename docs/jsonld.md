# JSON-LD framing — working notes

> Reference: [JSON-LD 1.1 Framing](https://www.w3.org/TR/jsonld-11-framing/).
> The framing layer used across the packages lives in
> `packages/utils` (`frameDoc`) with the vocabulary in
> `packages/data-model/src/context.ts`; the activity-registry decode that
> hit the gotchas below is `packages/authorization-agent/src/activity-registry.ts`
> (`frameActivity` + the per-class `loadActivity` cases).

## Framing section

`frameActivity` frames a single activity document with:

```ts
frameDoc(doc, dataModelContext, id, { object: { '@embed': '@always' } })
```

- `object: { '@embed': '@always' }` — snapshot objects (urn:uuid, or real-id
  embedded projections) are embedded **from the same document** (no
  cross-graph dereference); live-link objects (external IRIs) stay plain
  strings.
- Inside the embedded node, every other property frames with the default
  `@embed: '@never'` — plain IRIs/literals only.

### Gotcha 1 — a single embedded node frames as an OBJECT, not an array

JSON-LD framing collapses a single value into a **scalar** (for strings) or an
**object** (for embedded nodes) unless the term declares
`"@container": "@set"`. The activity `object` term does **not** declare a set
container, so:

| `as:object` written as | frames back as |
|---|---|
| two+ embedded nodes | `object: [node1, node2]` (array) |
| **one** embedded node | `object: { … }` (single object) |
| one live-link IRI | `object: '<iri>'` (string) |
| deny snapshot | `{ … }` (single object) |

**What broke:** the `AuthorizationGranted` decoder assumed arrays-or-strings.
A **share** writes exactly **one** DA per activity → the singleton framed as an
object → the decoder fell into the deny-snapshot branch → all DA fields were
dropped → the workflow never materialized → no grants, no registration Update
(`test/share.test.ts` timed out).

**Rule (pre-TODO 2):** decoders must normalize scalar-or-array per property (the
`asString` / `asStringArray` pattern), and for embedded object forms detect
the node kind by its rdf:type **before** falling back to a "snapshot"
interpretation:

```ts
object: Array.isArray(node.object)
  ? node.object.map((member) => (typeof member === 'string' ? member : toPojo(member)))
  : typeof node.object === 'string'
    ? [node.object]
    : typesContain(node.object, INTEROP.DataAuthorization)   // singleton embedded DA
      ? [toPojo(node.object)]
      : { /* deny snapshot */ }
```

**Resolved for `AuthorizationGranted` by TODO 2:** the default frame (phase 1)
makes the singleton/deep forms UNIFORM — `object` always frames to plain-IRI
string(s) (scalar for one, array for many), and phase 2 re-frames each id
with `DataAuthorizationFromJsonLd`. Gotcha 1 still applies to the classes that
keep the wildcard embed.

### Gotcha 2 — `@reverse` terms do not resolve on nested embedded nodes

`hasInheritingAuthorization` is declared as `{ '@reverse': inheritsFromAuthorization }`
— it resolves for the **top-level matched node** (`DataAuthorization.fromJsonLd`)
but (pre-TODO 2) returned `[]` on **nested embedded nodes** (the
`AuthorizationGranted` object children), because the wildcard `@embed: '@always'`
emitted the embedded graph without a property frame. The parent's children are
re-linked store-side via the child's **forward** `inheritsFromAuthorization`
triple. **Resolved for `AuthorizationGranted` by TODO 2** (two-phase framing:
each object re-frames the same doc by its own id, so `@reverse` resolves at the
top-level matched node) — the gotcha still applies to the remaining wildcard-
embedded classes (invitation/role/admin objects, if they carried reverse terms).

### Gotcha 3 — `@type` is an unordered set

JSON-LD `@type` values may frame back in any order, so activity-class
discrimination must be by **set membership** (`activityClass(type)` finds the
element that is neither `Activity` nor an ASV verb), never by position.

### Gotcha 4 — unknown terms are silently dropped on write

JSON-LD expansion drops keys that have no term in the active `@context`. The
RPC structure fields (`agentType`, `granted`, `applicationId`, …) have no
`dataModelContext` terms — they can never ride the wire; every wire object
must be term-covered (see `payload-contract-alignment.md` / the
`authorization-granting.md` term-gap).

## TODO — move the scalar/array and object-unwrapping normalization into framing

All decoder-side normalizations that survive the shared `dataModelContext`
framing (scalar-or-array `type`, the string-or-embedded-object
`nodeId`/`asString` unwrapping, the hand-rolled expanded-doc walks, and the
per-model boilerplate around `frameDoc`) can be pushed into framing or a
shared utils layer. Verified against jsonld 9.0.0 through the real
`frameDoc` + `dataModelContext`; none of it is implemented yet. Order of
implementation is the TODO order.

### TODO 1 — enforce `type` as always-array with `@container: "@set"` on the `@type` alias — ✅ DONE

**Implemented:** `context.ts` now has `type: { '@id': '@type', '@container': '@set' }` (plus `@version: 1.1` for the explicit 1.1-mode guarantee); all 17 `type: node.type ? (Array.isArray…): []` ternaries across `data-model/src`, `sparql.ts` (×2), components `Authorization.ts` (embedded need nodes) and the `asStringArray(node.type)` in `activity-registry.ts` simplified to `node.type ?? []`. Workspace build + all package vitest suites pass.

The shared context term is currently a bare alias:

```ts
// packages/data-model/src/context.ts
type: '@type',
```

so a single `rdf:type` always frames/compacts as a **scalar** — the reason
every model in `packages/data-model/src` needs the identical
`Array.isArray(node.type) ? node.type : [node.type]` ternary (11 copies:
`registry-set`, `admin-authorization`, `shape-tree-description`,
`social-agent-invitation`, `shape-tree`, `access-need-group-description`,
`access-need`, `access-need-group`, `social-agent-registration`, `role`, plus
`nodeIds` in `data-authorization` and `asStringArray` in `activity-registry`).

Change the term to force the array:

```ts
type: { '@id': '@type', '@container': '@set' },
```

**Why it works** — this is spec-explicit, not a jsonld.js quirk:
[JSON-LD 1.1 API Compaction Algorithm](https://www.w3.org/TR/jsonld-11-api/#compaction-algorithms),
`@type` branch: *"Initialize `as array` to true if processing mode is
`json-ld-1.1` and the container mapping for alias in the active context
includes `@set`"*. jsonld.js implements exactly that
(`node_modules/jsonld/lib/compact.js`: *"treat as array for @type if
@container includes @set"*). The scalar `type` is the same single-value
collapse as Gotcha 1, applied to `@type` — and it is purely the term
definition, not a framing-algorithm property.

**Verified** (`frameDoc` + real `dataModelContext`, single `rdf:type`):

```js
type: ['http://…/solid/interop#DataAuthorization']   // array, always
```

in both `compact` and `frame` (frame compacts its output), from any input
form (compacted-form and expanded-form inputs both tested).

**Condition — processing mode json-ld-1.1.** jsonld.js defaults to 1.1 (so it
works today), but `dataModelContext` deliberately carries no `@version: 1.1`.
For an explicit guarantee add `@version: 1.1` to the context — harmless: 1.0
features are a subset of 1.1 and `@version` does not force `@protected`, which
the same file relies on staying unset.

**Payoff:** all 11 scalar/array ternaries and the `type` branch of
`nodeIds`/`asStringArray` become dead; with TODO 2, `type` is structurally
`string[]` end to end (`DataAuthorizationData['type']: string[]` holds with no
normalization). No test currently asserts a scalar `type` (all assert arrays).

### TODO 2 — Option 2: replace embedded-object unwrapping with two-phase framing — ✅ DONE

**Implemented:** `data-authorization.ts` — `nodeId`/`nodeIds`/
`compactNodeToDataAuthorizationData` deleted; `fromJsonLd` now maps the
uniform default-frame output directly (`node.type ?? []`, plain-IRI reads,
`@omitDefault` absent → `undefined`/`[]`). `activity-registry.ts` —
`frameActivity` is class-gated via `docHasClass` (matches both full-IRI and
compacted-term `@type`): `AuthorizationGranted` → default frame (phase 1,
`as:object` → plain-IRI string(s)); need-based classes → deep frame (unchanged);
all others → wildcard embed (unchanged). `loadActivity` fetches once and
re-frames the same doc per object id with `DataAuthorizationFromJsonLd`
(phase 2). `index.ts` exports `fromJsonLd as DataAuthorizationFromJsonLd`.
Payoff verified in the unit test: `@reverse` `hasInheritingAuthorization` now
RESOLVES on the object POJOs (previously `[]`, Gotcha 2). Workspace build +
all package vitest suites pass.

`nodeId`/`nodeIds` (`data-authorization.ts`) and `asString`/`asStringArray`
(`activity-registry.ts`) tolerate two shapes because the activity frame embeds
`as:object` nodes in their entirety (`@embed: '@always'` wildcard): refs to
nodes absent from the doc compact to plain strings, refs to in-doc nodes
(activity-graph children) embed as `{ id, … }` objects that must be unwrapped.

**Two-phase alternative (Option 2)** — one uniform frame, no unwrapping:

1. **Phase 1:** frame the activity with the **default** frame (every property
   `@embed: '@never'` — no `object` override). `as:object` then frames to
   **plain IRI string(s)** whether the node is in the doc or not; scalar/array
   still needs `asStringArray` (Gotcha 1 — the `object` term has no set
   container).
2. **Phase 2:** re-frame the **same doc** per object id with the existing
   per-resource read path — `fromJsonLd(doc, objectId)`. The default frame
   resolves `@reverse` on the top-level matched node (Gotcha 2's *good*
   case), so `hasInheritingAuthorization` children come back as plain-IRI
   arrays; absent optional fields are omitted (`@omitDefault` on every
   property of `buildFrame`) — the exact shape
   `compactNodeToDataAuthorizationData` produces today, without the embedded
   path's `[]`/`null` noise.

```ts
// loadActivity, AuthorizationGranted case
const ids = asStringArray(node.object)   // phase 1: plain IRIs
return {
  …,
  object: await Promise.all(ids.map((id) => fromJsonLd(doc, id))),
}
```

**Payoff:** `compactNodeToDataAuthorizationData`, `nodeId`, `nodeIds` die;
embedded objects of the other classes (invitation, role, registration, admin
authorization) could follow the same re-frame pattern.

**Class-gating — required, verified empirically:**

- **Live-link classes** (`AuthorizationRevoked`, `DelegatedGrantsUpdated` —
  `object` is an IRI to a node **absent** from the doc) must NOT be
  re-framed: `fromJsonLd`/`frameDoc` throws *"Node … not found"*. They keep
  the direct plain-IRI read.
- **Need-based classes** (`NeedBasedAccessRequestSent/Received`) keep their
  deep frame: flattening `hasAccessNeedGroup` to an IRI string would drop the
  group the approval workflow resolves. Their object ids would re-frame with
  a deep per-id frame instead of `fromJsonLd`.
- A property-bearing sub-frame on `object` (the whitelist idea) breaks
  live-link classes (frames to `null` instead of the IRI) — that is why
  Option 2 keeps **one** uniform default frame and class-gates only the
  re-frame step.

**Cost:** N+1 in-memory frames per activity with N embedded objects (one for
the activity + one per object id); the docs are small and local, no
cross-graph dereference.

### TODO 3 — typed `frameNode` front + accessor family in utils — ✅ DONE

**Implemented:** `packages/utils/src/jsonld.ts` adds `FramedNode` (typed
`id`/`@id`/`type` keys, the rest `unknown`), `frameNode(doc, context, iri,
overrides?)` (typed `frameDoc` — no more `as any` casts), and the accessor
family `str` (required single, `''` fallback), `opt` (optional single,
`undefined`), `strs` (array, scalar-or-array absorbed, `[]` fallback) — the
accessors also unwrap language-tagged literals, absorbing the `framedValue`
call sites. All 18 data-model `fromJsonLd` mappers (plus `data-instance`'s
`frameDataInstance`/`labelFromNode`/`childIris` and `access-request`'s deep-
frame mapper, where `strs`/`str` read the embedded group node) now use
`frameNode` — zero `frameDoc`/`as any`/`framedValue` left in
data-model/src. Workspace build + all package vitest suites pass.

**Remaining adopters (not part of this TODO):** `authorization-agent`
`sparql.ts` mappers and `components` `Authorization.ts` embedded-need reads
still use the manual pattern; `documentValues` stays (path-agnostic whole-doc
walk).

The 17 `fromJsonLd` mappers each start with the same three lines, cast to
`any` and re-normalizing by hand:

```ts
const node = (await frameDoc(doc, dataModelContext, id)) as any
return {
  id: node.id ?? node['@id'],   // 12 copies
  type: node.type ? (Array.isArray(node.type) ? node.type : [node.type]) : [],  // 17 copies
  …
}
```

Add a typed front to `packages/utils/src/jsonld.ts` that centralizes all
three (after TODO 1 the `type` ternary is already gone, but the cast and the
id fallback remain):

```ts
export type FramedNode = { id?: string; '@id'?: string; type?: string[] } &
  Record<string, string | string[] | undefined>

/** frameDoc + normalize: id fallback, always-array type, no `any`. */
export async function frameNode(
  doc: unknown,
  iri: string,
  overrides?: Record<string, Record<string, unknown>>
): Promise<FramedNode>
```

Mappers shrink to pure typed field reads:

```ts
export async function fromJsonLd(doc, id): Promise<RoleData> {
  const node = await frameNode(doc, id)
  return { id, type: node.type ?? [], label: node.label ?? '', members: node.members ?? [] }
}
```

Plus an accessor family to absorb the remaining `?? ''` / `?? undefined` /
`framedValue` noise (17 call sites):

```ts
str(node, 'label')   // string (also unwraps language-tagged literals — replaces framedValue)
strs(node, 'members')
opt(node, 'note')    // string | undefined
```

### TODO 4 — `findNodeIdByType` via a wildcard type-frame — ✅ DONE

**Implemented:** the recursive expanded-doc walker (25 lines) is replaced by
`jsonld.frame(doc, { '@type': typeIri })` — the framing algorithm does the
first-match selection (single match → the node, multiples → `@graph`, none →
`{}`). Verified edge cases: multi-match picks the first node in document
order; `base` + `compactToRelative: false` keeps `@id`s absolute (frame()
relative-izes against base by default — would break the absolute-id contract
and `discovery.ts`'s `storageIri`). Same throw message. The utils suite
(8 tests incl. `findNodeIdByType`) + full workspace vitest pass.

`findNodeIdByType` currently walks the expanded document recursively (~30
lines) to find the first node of a type. A frame with only `{'@type': typeIri}`
makes the framing algorithm do the match — verified shapes on jsonld 9.0.0:
single match → the node itself, multiple matches → `{ '@graph': […] }`, no
match → `{}`:

```ts
export async function findNodeIdByType(doc, typeIri, base?) {
  const framed = await jsonld.frame(doc, { '@type': typeIri }, opts)
  const node = (framed as any)['@id'] ? framed : (framed as any)['@graph']?.[0]
  if (!node?.['@id']) throw new Error(`no node of type ${typeIri} in document`)
  return node['@id']
}
```

Same throw contract as today; deletes the walker (also simplifies
`discovery.ts`'s `storageIri` path through it).

### TODO 5 — `client-id-document`: kill the dual-key reads with a per-model context — ✅ DONE

**Implemented:** a per-model `clientIdContext` (= `dataModelContext` with the
`callbackEndpoint`/`hasAccessNeedGroup` terms redefined WITHOUT the
`@type: '@id'` coercion — the `data-instance.ts` per-model context pattern).
With coercion, a client id document whose own (OIDC) context types the values
as plain strings compacts a literal under the RAW IRI key; without coercion,
node references, literal strings and `{ '@value' }` literals ALL compact to
the term key, and `opt` unwraps every form. Verified against both test wires
(literal/OIDC doc and node-ref/doc-form); both client-id tests pass, as do
all workspace vitest suites; the dual-key `node[INTEROP.…]` reads are gone.

`client-id-document.ts` reads both the term key AND the raw IRI key
(`node.callbackEndpoint ?? node[INTEROP.hasAuthorizationCallbackEndpoint]`)
because the same wire value can be an IRI (node reference) or a literal
(doc-embedded OIDC context types it as a string). Verified: with
`@type: '@id'` coercion on a term, a *literal* value compacts under the raw
IRI key, not the term key — that is what the fallback catches.

Fix: per-model context **without** coercion on the ambiguous terms (the
`data-instance.ts` per-shape-tree context pattern), then read uniformly with
`framedValue` (handles plain string, `{ id }`, and literal forms):

```ts
const clientIdContext: JsonLdContext = {
  ...dataModelContext,
  callbackEndpoint: { '@id': INTEROP.hasAuthorizationCallbackEndpoint },
  hasAccessNeedGroup: { '@id': INTEROP.hasAccessNeedGroup },
}
// mapper: callbackEndpoint: framedValue(node.callbackEndpoint)
```

### TODO 6 — one generic loader for the fetch+decode pairs — ✅ DONE

**Implemented:** `loader<T>` factory in `packages/utils/src/jsonld.ts`:

```ts
export function loader<T>(decode: (doc: unknown, id: string) => Promise<T>) {
  return async (id: string, fetch: WhatwgFetch): Promise<T> =>
    decode(await fetchJsonLd(id, fetch), id)
}
```

All 18 `loadX` wrappers in `packages/data-model/src` became
`export const loadX = loader(fromJsonLd)` — `T` is inferred per model from
`fromJsonLd`'s return type (single source of truth), `WhatwgFetch` moved out
of the model files into the factory signature, and the `fetchJsonLd` imports
dropped (17 files; `shape-tree` keeps both — it also fetches shape tree
descriptions). `data-instance`'s `frameDataInstance(id, fetch, shapeTree,
docIri?)` keeps its hand-written signature (extra args + dynamic per-tree
context). Workspace build + all package vitest suites pass.

All 18 `loadX` wrappers in `packages/data-model/src` are the identical pair:

```ts
export async function loadRole(id: string, fetch: WhatwgFetch): Promise<RoleData> {
  return fromJsonLd(await fetchJsonLd(id, fetch), id)
}
```

**Where the TS type goes:** on a generic **factory** in utils — the generic
parameter `T` is introduced once on the factory signature and *instantiated
by inference* at each model's use site, from the model's `fromJsonLd` return
type; no per-model annotation needed:

```ts
// utils/src/jsonld.ts
export function loader<T>(decode: (doc: unknown, id: string) => Promise<T>) {
  return (id: string, fetch: WhatwgFetch): Promise<T> =>
    decode(await fetchJsonLd(id, fetch), id)
}

// role.ts — T is inferred as RoleData from fromJsonLd's signature
// (single source of truth; `WhatwgFetch` moves out of the model files)
export const loadRole = loader(fromJsonLd)
```

Alternatives: explicit per-model annotation
(`export const loadRole: (id, fetch) => Promise<RoleData> = loader(fromJsonLd)`)
for discoverability — redundant; or drop `loadX` entirely (Option B) and let
call sites write `fromJsonLd(await fetchJsonLd(id, fetch), id)` — the type
then comes from each model's exported `fromJsonLd` at the call site, no new
type surface at all.

**Scope:** all 18 current `loadX`es fit (deep-frame overrides and
`documentValues` live *inside* the models' `fromJsonLd`, not the loader).
The exception is `data-instance`'s `frameDataInstance(id, fetch, shapeTree,
docIri?)` — it takes extra args and uses the dynamic per-tree context, so it
keeps a hand-written signature.

### Keep as-is (not TODOs)

- **The explicit mappers** — wire-contract alignment; a generic
  context-driven mapper DSL buys little and obscures each model.
- **`documentValues`** — a frame reaches other nodes only via a known
  predicate path; the path-agnostic whole-doc walk is the point.
- **`linkedIrisJsonLd`**, **`registry-set`'s `{ id }` XId wrapping**,
  **`data-instance`'s per-shape-tree context** — already in the right shape
  (TODO 5 follows the data-instance pattern).