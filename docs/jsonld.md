# JSON-LD in this repo — how it works

> References: [JSON-LD 1.1 Framing](https://www.w3.org/TR/jsonld-11-framing/),
> [JSON-LD 1.1 API](https://www.w3.org/TR/jsonld-11-api/).
> The layer lives in `packages/utils/src/jsonld.ts` (jsonld 9.0.0); the
> vocabulary is the single shared context `packages/data-model/src/context.ts`
> (`dataModelContext`).

## The pieces

**One shared context for every model.** `dataModelContext` declares all wire
terms once — node references get `@type: '@id'` (compact to plain IRI strings),
multi-values get `@container: '@set'` (always arrays), reverse relationships
are `@reverse` terms, literals (`label`, `definition`, `note`) stay
uncoerced. It carries `@version: 1.1` (required for the `@set`-on-`@type`
behavior) and no `@protected`, so per-model overrides can spread-rewrite terms
(`data-instance` maps `label` to the shape tree's `describesInstance`; the
client-id context drops `@type: '@id'` coercion on two terms). Notably:

```ts
type: { '@id': '@type', '@container': '@set' },   // rdf:type ALWAYS frames to string[]
```

This is spec-explicit (1.1 compaction: "@type … as array … container …
`@set`") — a single `rdf:type` compacts to a one-element array, so no mapper
ever has to handle a scalar `type`.

**Framing, not compacting, for reads.** Compaction alone can't filter to one
node in a multi-node document, resolve `@reverse`, or omit absent keys, so
every read goes through `frame()`:

```ts
// utils/src/jsonld.ts
frameNode(doc, context, iri, overrides?) → Promise<FramedNode>
// typed: { id?, '@id'?, type?: string[] } & Record<string, unknown>
```

`buildFrame` gives every property `{ '@embed': '@never', '@omitDefault': true }`
— node refs stay references (coerced to plain IRIs), `@reverse` children
resolve on the top-level matched node, absent properties are omitted.
`overrides` swaps the frame entry per key (e.g. `@embed: '@always'` for the
snapshot object embeds below).

**Accessors.** The framed node's values are typed `unknown`; the accessor
family unwraps them (also language-tagged literals):

```ts
str(node, 'grantee')   // required single → string, '' when absent
opt(node, 'note')      // optional single → string | undefined
strs(node, 'accessMode') // array (scalar-or-array absorbed) → string[], [] when absent
```

**Models.** Each data model in `data-model/src` exposes `fromJsonLd(doc, id) →
POJO` (writable ones also have `toJsonLd` for the write path). The mappers
are uniform — `frameNode` + the accessor family, no casts, no normalization
boilerplate — and the POJO fields mirror the context terms, so the types and
the wire stay in lockstep.

**Loaders.** There are no `loadX` exports — consumers compose the generic
factory at module top:

```ts
import { Grant } from '@janeirodigital/interop-data-model'
import { loader } from '@janeirodigital/interop-utils'
const loadGrant = loader(Grant.fromJsonLd)   // (id, fetch) => Promise<GrantData>
```

`T` is inferred from `fromJsonLd`'s return type; `WhatwgFetch` stays in the
factory signature.

## The read path

```text
fetchJsonLd(iri, fetch)         raw doc (expanded/compacted/flattened, any form)
  → frameNode(doc, ctx, iri)    jsonld.frame → one node, plain-IRI/literal values
  → accessors (str/opt/strs)    model POJO fields
  → loader(fromJsonLd)          the consumer-facing (id, fetch) loader
```

The document form is irrelevant — `frame()` expands first. `@reverse` is why
children (`hasInheritingAuthorization`, `hasInheritingGrant`, …) come back
without any store query: the framed node's inverse quads resolve to plain-IRI
arrays.

## The activity-registry decode (the class-gated case)

`activity-registry.ts` (`loadActivity`) is the one place the wildcard embed
is still needed. `frameActivity` sniffs the raw doc's `@type`
(`docHasClass` — matches full-IRI or compacted-term values) and picks per
class:

- **`AuthorizationGranted` — two-phase framing**: the DEFAULT frame (phase 1)
  makes `as:object` frame to plain-IRI string(s) (scalar for one, array for
  many — the `object` term has no set container); phase 2 re-frames the SAME
  doc once per object id via `DataAuthorizationFromJsonLd(doc, objectId)`.
  Every object POJO gets the uniform read (plain-IRI refs, `@reverse`
  children resolved), no embedded-node unwrapping. N+1 in-memory frames for N
  objects. Live-link classes (`AuthorizationRevoked`,
  `DelegatedGrantsUpdated`) keep their direct plain-IRI read — re-framing an
  id that is not in the doc would throw *"Node … not found"*.
- **Need-based classes** (`NeedBasedAccessRequestSent/Received`) — the DEEP
  frame: the request snapshot embeds its COMPLETE group
  (`hasAccessNeedGroup → hasAccessNeed → hasInheritingNeed`, all
  `@embed: '@always'`), because the approval workflow resolves the needs'
  inherited children from the activity graph.
- **Everything else** — the wildcard `{ '@embed': '@always' }` on `object`:
  snapshot objects (invitation, role, admin-authz, …) embed from the same
  document; a live-link object (not in the doc) stays a plain-IRI string; the
  framer never dereferences.

## Embedding semantics to remember

- **Single values collapse to scalars/objects** unless the term has
  `@container: '@set'`. `type` is solved (set container); `object` and the
  deep-frame group reads are not — mappers wrap with the scalar-or-array
  pattern (`asStringArray` in the activity decoder, `strs` elsewhere).
- **`@reverse` resolves on the top-level matched node only** — not on nodes
  embedded by a wildcard. `AuthorizationGranted`'s objects are exempt
  (two-phase re-frame makes each object a top-level match); the other
  embedded snapshot objects still see `[]` for reverse terms.
- **`@type` is an unordered set** — reuse the order-independence of the set.
  Activity-class discrimination is by set membership (`activityClass`), never
  position in the framed tuple.
- **A literal under an `@type: '@id'`-coerced term compacts under the raw IRI
  key, not the term key** — this is why client-id documents (whose own OIDC
  context types values as plain strings) use a per-model context WITHOUT
  coercion on those terms; then node refs, literal strings and `{ '@value' }`
  literals all land on the term key and `opt` unwraps every form.

## The write path

```text
withContext(dataModelContext, pojo)   attach the context to the POJO
  → putJsonLd(iri, fetch, doc)        jsonld.expand → PUT expanded JSON-LD
```

Put bodies are expanded form (context used only to expand) — context-version
proof on the wire. Expansion silently drops keys with no term, so every wire
object must be term-covered (that is also why `toRDF`-tolerant templates carry
only context terms).

## The remaining manual helpers

- `documentValues(doc, iri, predicate)` — collect a predicate's values across
  ALL nodes of a document (e.g. `usesLanguage` on the description sets of an
  access-need/shape-tree document). A frame reaches other nodes only via a
  known predicate path, so the path-agnostic whole-doc walk stays manual.
- `linkedIrisJsonLd(id, fetch, propertyIri)` — single-property framer
  (registry `ldp:contains`, …).
- `findNodeIdByType(doc, typeIri, base)` — first node of a type, via a
  wildcard `{ '@type' }` frame (single match → node, multiples → `@graph`,
  none → throws); `compactToRelative: false` keeps `@id`s absolute.
- `authorization-agent/src/sparql.ts` mappers and
  `components/src/services/Authorization.ts` embedded-need reads still use
  `frameDoc` + manual casts rather than `frameNode`/accessors (SPARQL
  transport + composed reads) — candidates for the same treatment.