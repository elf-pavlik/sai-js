# Plan: Simplify Data Grants as Plain JSON Objects

## Goal

Replace the current class hierarchy for Data Grants (`ImmutableDataGrant`, `AbstractDataGrant`, `InheritableDataGrant`, `AllFromRegistryDataGrant`, `SelectedFromRegistryDataGrant`, `InheritedDataGrant`) with a single `GrantData` plain JSON object type. All behavior moves to a new `Grant` module as free functions that take a `GrantData` object as the first parameter.

## Design Principles

- **RDF/JS DatasetCore (N3 Store) as the common interchange format** — parse turtle from the wire into a dataset; serialize a dataset to turtle for PUT. JSON-LD is only used for in-memory conversion between datasets and POJOs.
- **Turtle on the wire, JSON-LD internally** — `fetch` (GET/PUT) always uses `text/turtle`. The `serializeTurtle` / `parseTurtle` helpers from `@janeirodigital/interop-utils` are unchanged.
- **Symmetric round-trip via JSON-LD context**:
  - **Write path**: `GrantData` → add `@context` → `JSON.stringify()` → `parseJsonld()` (from interop-utils, uses `jsonld-streaming-parser`) → N3 Store → `serializeTurtle()` → PUT.
  - **Read path**: GET → `parseTurtle()` → N3 Store → `JsonLdSerializer({ context })` (from `jsonld-streaming-serializer`) → compacted JSON-LD string → `JSON.parse()` → extract node → `GrantData`.
- **No grant-embedding** — `hasInheritingGrant` is `string[]` (array of child grant IRIs), never nested `GrantData[]`. References are resolved lazily.
- **We still write inverse `inheritsFromGrant` quads** in the parent's document, so the parent's dataset contains `<childIri> interop:inheritsFromGrant <parentIri>`. The JSON-LD context uses `@reverse` so that compaction puts the child IRIs into `hasInheritingGrant` on the parent node. Each child appears only as `{ "@id": "childIri" }`, never embedded.
- **No caching** — remove the `factory.cache.dataGrant` map. Each call to `dataGrant()` fetches fresh.
- **Scope-based dispatch via switch** — instead of polymorphic subclass methods, functions switch on `scopeOfGrant` (`AllFromRegistry` / `SelectedFromRegistry` / `Inherited`).

## Dependencies

- **Add** `jsonld-streaming-serializer` to `packages/data-model/package.json` — for compacting a dataset to JSON-LD (read path).
- **Already available** via `@janeirodigital/interop-utils`: `jsonld-streaming-parser` (used by `parseJsonld()`), `parseTurtle`, `serializeTurtle`, `n3`, INTEROP namespace, etc.

## Serialization Flow

### Write path (storing a grant)

```
GrantData POJO
  │  attach @context
  ▼
{ "@context": grantContext, ...grant }
  │  JSON.stringify
  ▼
JSON-LD string
  │  parseJsonld()  (uses jsonld-streaming-parser)
  ▼
N3 Store (DatasetCore)
  │  serializeTurtle()
  ▼
Turtle string
  │  PUT with Content-Type: text/turtle
  ▼
Server
```

### Read path (fetching a grant)

```
Server
  │  GET (accepts text/turtle)
  ▼
Turtle response
  │  parseTurtle()
  ▼
N3 Store (DatasetCore)
  │  JsonLdSerializer({ context: grantContext })  (uses jsonld-streaming-serializer)
  │  collects compacted JSON-LD string
  ▼
Compacted JSON-LD string
  │  JSON.parse() + extract node at @id === iri
  ▼
GrantData POJO
```

## Steps (in suggested implementation order)

### Phase 1 — Create types, context, and Grant module (alongside existing code)

**1a. Create `src/grant-context.json`** — local JSON-LD context

All multi-value properties use `"@container": "@set"` which guarantees the
compacted JSON-LD always produces an array per the JSON-LD 1.1 specification,
even for single-element sets. Zero matching quads means the key is absent
(handled by `?? []` in `termArray()` below).

```json
{
  "@context": {
    "id": "@id",
    "type": "@type",

    "grantee": { "@id": "http://www.w3.org/ns/solid/interop#grantee", "@type": "@id" },
    "grantedBy": { "@id": "http://www.w3.org/ns/solid/interop#grantedBy", "@type": "@id" },
    "dataOwner": { "@id": "http://www.w3.org/ns/solid/interop#dataOwner", "@type": "@id" },
    "registeredShapeTree": { "@id": "http://www.w3.org/ns/solid/interop#registeredShapeTree", "@type": "@id" },
    "hasDataRegistration": { "@id": "http://www.w3.org/ns/solid/interop#hasDataRegistration", "@type": "@id" },
    "hasStorage": { "@id": "http://www.w3.org/ns/solid/interop#hasStorage", "@type": "@id" },
    "scopeOfGrant": { "@id": "http://www.w3.org/ns/solid/interop#scopeOfGrant", "@type": "@id" },

    "accessMode": { "@id": "http://www.w3.org/ns/solid/interop#accessMode", "@type": "@id", "@container": "@set" },
    "creatorAccessMode": { "@id": "http://www.w3.org/ns/solid/interop#creatorAccessMode", "@type": "@id", "@container": "@set" },
    "hasDataInstance": { "@id": "http://www.w3.org/ns/solid/interop#hasDataInstance", "@type": "@id", "@container": "@set" },

    "inheritsFromGrant": { "@id": "http://www.w3.org/ns/solid/interop#inheritsFromGrant", "@type": "@id" },
    "delegationOfGrant": { "@id": "http://www.w3.org/ns/solid/interop#delegationOfGrant", "@type": "@id" },

    "hasInheritingGrant": {
      "@reverse": "http://www.w3.org/ns/solid/interop#inheritsFromGrant",
      "@container": "@set"
    }
  }
}
```

`hasInheritingGrant` uses `@reverse` because the RDF triple is `<childIri> interop:inheritsFromGrant <parentIri>`. During compaction, the parent node collects the child `@id`s into a `hasInheritingGrant` array.

**1b. Create `GrantData` type** — in `src/grant.ts`

```typescript
/** Plain JSON representation of a Data Grant. */
export type GrantData = {
  /** IRI of the grant resource; absent until assigned by registry */
  id?: string

  // String properties (single-value named nodes)
  grantee: string
  grantedBy: string
  dataOwner: string
  registeredShapeTree: string
  hasDataRegistration: string
  hasStorage: string
  scopeOfGrant: string

  // Array properties (multi-value named nodes)
  accessMode: string[]
  creatorAccessMode?: string[]
  hasDataInstance?: string[]

  // Optional reference IRIs
  inheritsFromGrant?: string    // parent grant IRI (Inherited scope)
  delegationOfGrant?: string    // source grant IRI (delegated grants)

  // Children discovered via inverse quads in the dataset (lazily resolved)
  hasInheritingGrant?: string[] // child grant IRIs
}

/** A grant that has been assigned its storage IRI. */
export type FinalGrantData = GrantData & Required<Pick<GrantData, 'id'>>
```

**1c. Create Grant module functions** — in `src/grant.ts`

```typescript
import grantContext from './grant-context.json'
import { JsonLdSerializer } from 'jsonld-streaming-serializer'
import { parseJsonld, INTEROP, RDF, ACL, serializeTurtle } from '@janeirodigital/interop-utils'
import { Store, DataFactory } from 'n3'
import type { DatasetCore } from '@rdfjs/types'
import type { BaseFactory, DataInstance } from '.'

// ──────────────────────────
// Read path: Dataset → GrantData
// ──────────────────────────

/**
 * Convert a parsed RDF dataset into a compacted JSON-LD string using the local context,
 * then extract the node for the given IRI as a GrantData POJO.
 */
export async function fromDataset(dataset: DatasetCore, iri: string): Promise<GrantData> {
  const serializer = new JsonLdSerializer({ context: grantContext })
  let output = ''
  serializer.on('data', (chunk: string) => { output += chunk })

  return new Promise((resolve, reject) => {
    serializer.on('end', () => {
      try {
        const compacted = JSON.parse(output)
        // The compacted output may be a single node or a @graph array
        const nodes = compacted['@graph'] ?? [compacted]
        const node = nodes.find((n: any) => n['@id'] === iri)
        if (!node) throw new Error(`Node ${iri} not found in compacted output`)
        resolve(compactNodeToGrantData(node))
      } catch (e) {
        reject(e)
      }
    })
    serializer.on('error', reject)

    // Write all quads from the dataset
    for (const quad of dataset) {
      serializer.write(quad)
    }
    serializer.end()
  })
}

/**
 * Extract a term value from a compacted JSON-LD node.
 * Values with @type: @id appear as { "@id": "..." } after compaction.
 */
function termValue(value: any): string | undefined {
  if (value === undefined || value === null) return undefined
  return value['@id'] ?? String(value)
}

/**
 * Extract an array of term values.
 * @container: @set guarantees the value is always an array when present
 * (per JSON-LD 1.1 spec). Zero matching quads → key is absent → ?? [].
 */
function termArray(values: any): string[] {
  return (values ?? []).map((v: any) => termValue(v) ?? v)
}

function compactNodeToGrantData(node: any): GrantData {
  return {
    id: node['@id'],
    grantee: termValue(node.grantee)!,
    grantedBy: termValue(node.grantedBy)!,
    dataOwner: termValue(node.dataOwner)!,
    registeredShapeTree: termValue(node.registeredShapeTree)!,
    hasDataRegistration: termValue(node.hasDataRegistration)!,
    hasStorage: termValue(node.hasStorage)!,
    scopeOfGrant: termValue(node.scopeOfGrant)!,
    accessMode: termArray(node.accessMode),
    creatorAccessMode: termArray(node.creatorAccessMode),
    hasDataInstance: termArray(node.hasDataInstance),
    inheritsFromGrant: termValue(node.inheritsFromGrant),
    delegationOfGrant: termValue(node.delegationOfGrant),
    hasInheritingGrant: termArray(node.hasInheritingGrant),
  }
}

// ──────────────────────────
// Write path: GrantData → Dataset → Turtle
// ──────────────────────────

/**
 * Serialize a FinalGrantData to a turtle string ready for PUT.
 *
 * Steps:
 *   1. Attach the local context to the grant POJO
 *   2. JSON.stringify → JSON-LD string
 *   3. parseJsonld → N3 Store (via jsonld-streaming-parser)
 *   4. serializeTurtle → turtle string
 */
export async function toTurtle(grant: FinalGrantData): Promise<string> {
  const jsonldDoc = { '@context': grantContext, ...grant }
  const jsonldStr = JSON.stringify(jsonldDoc)
  const store = await parseJsonld(jsonldStr, grant.id)
  return serializeTurtle(store)
}

// ──────────────────────────
// Behavior functions (replacing class methods)
// ──────────────────────────

/**
 * Iterate over data instances described by this grant.
 * Dispatches based on scopeOfGrant.
 */
export async function* getDataInstanceIterator(
  grant: GrantData,
  factory: BaseFactory
): AsyncIterable<DataInstance> {
  switch (grant.scopeOfGrant) {
    case INTEROP.AllFromRegistry.value: {
      const registration = await factory.readable.dataRegistration(grant.hasDataRegistration)
      for (const iri of registration.contains) {
        yield factory.dataInstance(iri, grant)
      }
      break
    }
    case INTEROP.SelectedFromRegistry.value: {
      for (const iri of (grant.hasDataInstance ?? [])) {
        yield factory.dataInstance(iri, grant)
      }
      break
    }
    case INTEROP.Inherited.value: {
      const parent = await factory.readable.dataGrant(grant.inheritsFromGrant!)
      for await (const parentInstance of getDataInstanceIterator(parent, factory)) {
        yield* parentInstance.getChildInstancesIterator(grant.registeredShapeTree)
      }
      break
    }
    default:
      throw new Error(`Unknown scope: ${grant.scopeOfGrant}`)
  }
}

/**
 * Generate a new IRI for a data instance within this grant's registration.
 */
export function iriForNew(grant: GrantData): string {
  return `${grant.hasDataRegistration}${randomUUID()}`
}

/**
 * Create a new DataInstance under this grant.
 * Throws if the grant scope does not support creation.
 */
export async function newDataInstance(
  grant: GrantData,
  factory: BaseFactory,
  parent?: DataInstance
): Promise<DataInstance> {
  if (grant.scopeOfGrant === INTEROP.SelectedFromRegistry.value) {
    throw new Error('Cannot create instances from SelectedFromRegistry grant')
  }
  if (!parent && grant.scopeOfGrant === INTEROP.Inherited.value) {
    throw new Error('Inherited grant requires a parent instance')
  }
  const iri = iriForNew(grant)
  return DataInstance.build(iri, grant, factory, parent, true)
}

/**
 * Whether the grant allows creating new data instances.
 */
export function canCreate(grant: GrantData): boolean {
  if (grant.scopeOfGrant === INTEROP.SelectedFromRegistry.value) return false
  return grant.accessMode.includes(ACL.Write.value)
}

/**
 * Derive the data registry IRI from the grant's hasDataRegistration.
 */
export function dataRegistryIri(grant: GrantData): string {
  const parts = grant.hasDataRegistration.split('/')
  return `${parts.slice(0, -2).join('/')}/`
}
```

Note: `randomUUID` is available via `factory.randomUUID` (from dependencies). The module function can either take it as a parameter or get it from the factory. Since `iriForNew` already accesses `grant.hasDataRegistration` (a string), we may want to inject `randomUUID` or have separate signatures — TBD during implementation.

### Phase 2 — Update `BaseFactory.readable.dataGrant()`

**Before** (base-factory.ts):
```typescript
dataGrant: async function dataGrant(iri: string): Promise<DataGrant> {
  const cached = factory.cache.dataGrant[iri]
  if (cached) return cached
  const response = await factory.fetch(iri)
  const dataset = await response.dataset()
  // switch on scopeOfGrant → pick subclass → construct
  // cache store
}
```

**After**:
```typescript
dataGrant: async function dataGrant(iri: string): Promise<GrantData> {
  const response = await factory.fetch(iri)
  const dataset = await response.dataset()
  return fromDataset(dataset, iri)
}
```

Remove the `cache` field from `BaseFactory` entirely (`Cache` interface, `cache` property, etc.).

Update the `BaseReadableFactory` interface: `dataGrant(iri: string): Promise<GrantData>`.

### Phase 3 — Update `AuthorizationAgentFactory.immutable.dataGrant()`

**Before**:
```typescript
dataGrant: function dataGrant(iri: string, data: DataGrantData): ImmutableDataGrant {
  return new ImmutableDataGrant(iri, factory, data)
}
```

**After**:
```typescript
dataGrant: function dataGrant(iri: string, data: GrantData): FinalGrantData {
  return { ...data, id: iri }
}
```

Consumers now get back a POJO. To store it, they call:
```typescript
const turtle = await toTurtle(finalGrant)
await factory.fetch(finalGrant.id!, {
  method: 'PUT',
  body: turtle,
  headers: { 'Content-Type': 'text/turtle', 'If-None-Match': '*' },
})
```

### Phase 4 — Delete old grant class files

Remove (type-check will confirm nothing else references them):
- `src/immutable/data-grant.ts`
- `src/readable/data-grant.ts`
- `src/readable/inheritable-data-grant.ts`
- `src/readable/all-from-registry-data-grant.ts`
- `src/readable/selected-from-registry-data-grant.ts`
- `src/readable/inherited-data-grant.ts`

### Phase 5 — Update exports

| File | Change |
|------|--------|
| `immutable/index.ts` | Remove `* from './data-grant'` |
| `readable/index.ts` | Remove `DataGrant` union type, remove all subclass exports. Keep `DataGrant` as a type alias for `GrantData` during migration: `export type DataGrant = import('../grant').GrantData` |
| `index.ts` | Add re-exports: `export { GrantData, FinalGrantData } from './grant'` and `export * as Grant from './grant'`. Also export `grantContext` if needed. |

### Phase 6 — Update all consumers (type-check pass)

The following files need updates. The strategy is: **replace `instanceof` with `scopeOfGrant` checks, replace method calls with Grant module function calls, replace `DataGrantData`/`FinalDataGrantData` with `GrantData`/`FinalGrantData`**.

**Within data-model package:**

| File | What changes |
|------|-------------|
| `readable/data-authorization.ts` | `DataGrantData`/`FinalDataGrantData` → `GrantData`/`FinalGrantData`. `generateDataGrants()` returns `{ source: GrantData[], delegated: GrantData[] }`. Inner methods updated. `sourceGrant.hasInheritingGrant` is now `string[]` (find by IRI, not by `.registeredShapeTree` on embedded object). |
| `readable/access-authorization.ts` | `GeneratedGrants` fields become `GrantData[]`. |
| `readable/application-registration.ts` | `getDataGrants()` returns `Promise<GrantData[]>`. |
| `crud/agent-registration.ts` | `getDataGrants()` helper returns `GrantData[]`. |
| `data-registration-proxy.ts` | `grant` property becomes `GrantData`. `instanceof` checks become `scopeOfGrant === '...'` checks. `getDataInstanceIterator()` → `Grant.getDataInstanceIterator()`. `newDataInstance()` → `Grant.newDataInstance()`. |
| `data-instance.ts` | `dataGrant` becomes `GrantData`. `findChildGrant()`: search `this.dataGrant.hasInheritingGrant` (string[]) by shape tree, fetch child grant via `factory.readable.dataGrant()`. `accessMode` getter: `return this.dataGrant.accessMode`. `newChildDataInstance()`: `Grant.newDataInstance(childGrant, this.factory, this)`. |
| `data-owner.ts` | `issuedGrants: GrantData[]`. Property access like `grant.registeredShapeTree` still works on POJO. |
| `base-factory.ts` | Remove cache. Update `dataGrant` return type. Pass `GrantData` to `DataInstance.build()` calls. |
| `authorization-agent-factory.ts` | Remove `ImmutableDataGrant` import. Return POJO from `immutable.dataGrant()`. |

**Outside data-model:**

| File | What changes |
|------|-------------|
| `application/src/application.ts` | `instanceof` checks → `scopeOfGrant` comparisons (lines 164-170). `.iriForNew()` → `Grant.iriForNew()`. `.hasDataInstance` → direct property access. `.hasDataRegistration` → direct property access. `.accessMode` → direct property access. |
| `components/src/GrantIssuanceHandler.ts` | `DataGrantData` → `GrantData`, `FinalDataGrantData` → `FinalGrantData`. `hasInheritingGrant` changes from `DataGrantData[]` to `string[]` — adjust mapping/generation accordingly. |
| `components/src/temporal/activities/grants.ts` | `storeDataGrant(payload: FinalGrantData)` — instead of `factory.immutable.dataGrant(...).put()`, use `toTurtle(payload)` + `fetch(payload.id, { method: 'PUT', body: turtle, headers })`. Other signatures update. |
| `components/src/temporal/workflows/grants.ts` | Type imports update. |
| `components/src/services/DataRegistry.ts` | `.dataRegistryIri` → `Grant.dataRegistryIri()`. `.getDataInstanceIterator()` → `Grant.getDataInstanceIterator()`. `.dataOwner` → direct property access. |
| `components/src/services/Authorization.ts` | `instanceof InheritedDataGrant` → `scopeOfGrant === INTEROP.Inherited.value` check. |

### Phase 7 — Update tests (run by user, not agent)

After type-check passes and before we consider the implementation complete, update these test files:

- `test/immutable/data-grant.test.ts` → test `fromDataset()` and `toTurtle()` round-trip
- `test/readable/data-grant.test.ts` → test Grant module functions
- `test/readable/all-from-registry-data-grant.test.ts` → fold into data-grant tests
- `test/readable/selected-from-registry-data-grant.test.ts` → fold into data-grant tests
- `test/readable/inherited-data-grant.test.ts` → fold into data-grant tests
- `test/authorization-agent-factory.test.ts` → update for POJO return
- `test/data-instance.test.ts` → update for `GrantData`
- `test/data-registration-proxy.test.ts` → update for scope checks

## Notes on `hasInheritingGrant` handling

Since we still write inverse `inheritsFromGrant` quads into the parent's document:

- **Write path**: `toTurtle()` includes the inverse quads in the dataset (via `parseJsonld` of the compacted doc, which processes the `@reverse` context and produces `<childIri> interop:inheritsFromGrant <parentIri>`).
- **Read path**: `fromDataset()` uses the `@reverse` context, so the parent node in the compacted output gets `hasInheritingGrant: [{ "@id": "childIri1" }, ...]`. We extract just the `@id` strings.
- When constructing a new `GrantData` for a parent that has children, the caller explicitly sets `hasInheritingGrant: [childIri1, childIri2, ...]` (strings). When reading back from storage, it's populated from the inverse quads via compaction.

## Summary of architecture shift

```
BEFORE                              AFTER
─────────────────                   ─────────────────
ImmutableDataGrant                  GrantData POJO
  constructor builds dataset          toTurtle() → parseJsonld → Store
  put() serializes & PUTs             → serializeTurtle → PUT

AbstractDataGrant                   GrantData POJO
  + subclasses (3)                    scopeOfGrant field
  memoized getters                    direct property access
  abstract getDataInstanceIterator()  Grant.getDataInstanceIterator(grant, fac)
  newDataInstance()                   Grant.newDataInstance(grant, fac, parent?)
  iriForNew()                         Grant.iriForNew(grant)
  canCreate getter                    Grant.canCreate(grant)
  dataRegistryIri getter              Grant.dataRegistryIri(grant)
  bootstrap() resolves children       (lazy — children in hasInheritingGrant[])

Factory caches grants                No caching
instanceof checks                    scopeOfGrant === '...' checks
DataGrantData / FinalDataGrantData   GrantData / FinalGrantData
```
