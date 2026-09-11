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

**Rule:** decoders must normalize scalar-or-array per property (the
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

### Gotcha 2 — `@reverse` terms do not resolve on nested embedded nodes

`hasInheritingAuthorization` is declared as `{ '@reverse': inheritsFromAuthorization }`
— it resolves for the **top-level matched node** (`DataAuthorization.fromJsonLd`)
but returns `[]` on **nested embedded nodes** (the `AuthorizationGranted`
object children). The parent's children are re-linked store-side via the
child's **forward** `inheritsFromAuthorization` triple, so materialization
works — but decoders must not rely on the reverse property inside an embedded
object.

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