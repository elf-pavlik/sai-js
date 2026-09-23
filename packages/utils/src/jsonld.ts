import type { DatasetCore, Quad } from '@rdfjs/types'
import * as jsonldNs from 'jsonld'
import { Store } from 'n3'
import { localDocumentLoader } from './jsonld-parser'
import type { WhatwgFetch } from './whatwg-fetch'
export { localDocumentLoader }

// CJS/ESM interop: jsonld is a CJS package; in the ESM bundle the namespace
// has the full exports only on .default.  Grab the full object so that all
// properties (fromRDF, compact, toRDF, expand, …) are available.
const jsonld = (jsonldNs as any).default ?? jsonldNs

export type JsonLdContext = Record<string, unknown>

/**
 * Collect the IRI values of a property (`propertyIri`) on the resource at
 * `id` from a raw JSON-LD GET. Node references are coerced to IRI strings
 * (`@type: '@id'` + `@container: '@set'` on the resolved term); an absent
 * property yields `[]`.
 */
export async function linkedIrisJsonLd(
  id: string,
  fetch: WhatwgFetch,
  propertyIri: string
): Promise<string[]> {
  const context: JsonLdContext = {
    [propertyIri]: { '@id': propertyIri, '@type': '@id', '@container': '@set' },
  }
  const node = (await frameDoc(await fetchJsonLd(id, fetch), context, id)) as any
  return node[propertyIri] ?? []
}

/**
 * Document loader that resolves known remote contexts (OIDC, notifications)
 * from bundled local copies instead of fetching them over the network.
 * SAI data never needs remote contexts beyond those two.
 */
const documentLoader = localDocumentLoader as any

export { documentLoader }

/** Build a JSON-LD frame that resolves the node at `iri` with all its
 * properties as plain node references (no embedding of referenced nodes).
 *
 * Each property in the context gets `@embed: "@never"` so that the
 * framing algorithm produces `@type: @id`-compacted plain IRI strings
 * instead of embedding full child graphs. This also resolves @reverse
 * relationships automatically.
 *
 * `overrides` replaces the default `@embed: '@never'` entry for selected
 * keys — e.g. `{ object: { '@embed': '@always' } }` for activity reads,
 * where in-document snapshot nodes embed while out-of-document live-link
 * nodes stay plain-IRI strings (no dereference).
 */
export function buildFrame(
  context: JsonLdContext,
  iri: string,
  overrides: Record<string, Record<string, unknown>> = {}
): Record<string, unknown> {
  const frame: Record<string, unknown> = {
    '@context': context,
    '@id': iri,
  }
  for (const [key, val] of Object.entries(context)) {
    if (key === 'id' || key === 'type' || key === '@version') continue
    if (typeof val === 'object' && val !== null) {
      frame[key] = overrides[key] ?? { '@embed': '@never', '@omitDefault': true }
    }
  }
  return frame
}

/**
 * Convert a parsed RDF dataset into a framed JSON-LD node.
 *
 * Uses jsonld.fromRDF + jsonld.frame to resolve @reverse relationships
 * automatically, without embedding child nodes.
 * Throws if the node is not in the framed output.
 */
export async function frameDataset(
  dataset: DatasetCore,
  context: JsonLdContext,
  iri: string
): Promise<Record<string, unknown>> {
  const expanded = await jsonld.fromRDF(dataset)
  return frameDoc(expanded, context, iri)
}

/**
 * Convert a JSON-LD document (fetched as application/ld+json) directly into a
 * framed node. The document can be in expanded, compacted, or flattened form.
 * Uses jsonld.frame to resolve @reverse relationships automatically, without
 * embedding child nodes.
 * Throws if the node is not in the framed output.
 */
export async function frameDoc(
  doc: unknown,
  context: JsonLdContext,
  iri: string,
  overrides: Record<string, Record<string, unknown>> = {}
): Promise<Record<string, unknown>> {
  const framed = await jsonld.frame(doc, buildFrame(context, iri, overrides) as any, {
    documentLoader,
  })
  if (!(framed as any).id && !(framed as any)['@id']) {
    throw new Error(`Node ${iri} not found in framed output`)
  }
  return framed as Record<string, unknown>
}

/**
 * A framed JSON-LD node from the shared data-model context: the well-known
 * keys are typed (`id`/`@id` — the `id` alias; `type` — the `@type` alias
 * with `@container: '@set'`, so always a string[], never a scalar), while
 * every other term key is `unknown`: node references compact to plain IRI
 * strings (`@type: '@id'` coercion), set terms to string arrays, literals to
 * plain strings or `{ '@value', … }` objects (unwrapped by the accessor
 * family), and absent properties are omitted (`@omitDefault`).
 */
export type FramedNode = {
  id?: string
  '@id'?: string
  type?: string[]
} & Record<string, unknown>

/**
 * Typed front for `frameDoc` — the uniform mapper entry replacing the
 * repeated `(await frameDoc(...)) as any` / `Record<string, unknown>` casts
 * across the data-model `fromJsonLd`s. The `str`/`opt`/`strs` accessors
 * handle per-field reads; `id`/`type` are read directly off the typed
 * `FramedNode`.
 */
export async function frameNode(
  doc: unknown,
  context: JsonLdContext,
  iri: string,
  overrides: Record<string, Record<string, unknown>> = {}
): Promise<FramedNode> {
  const node = (await frameDoc(doc, context, iri, overrides)) as Record<string, unknown> & {
    '@context'?: unknown
  }
  // the frame embeds its @context in the output — strip it so the node is
  // pure POJO data (term keys, plain-IRI/literal values only)
  const { '@context': _context, ...rest } = node
  return rest as FramedNode
}

/**
 * Select a model's fields from a framed node — the per-model whitelist
 * (docs/jsonld.md). Framing emits EVERY property of the focus node
 * (foreign predicates leak as raw-IRI keys), so the POJO is built from
 * exactly `id`/`type` + the model's terms — present values only; absent
 * means omitted (`undefined`), no `''`/`[]` defaults (`@set` containers
 * guarantee arrays when present).
 */
export function selectNode(
  node: FramedNode,
  terms: readonly string[]
): Record<string, string | string[] | undefined> {
  const out: Record<string, string | string[] | undefined> = {
    id: node.id ?? node['@id'],
    type: node.type ?? [],
  }
  for (const term of terms) {
    const value = node[term]
    if (value !== undefined && value !== null) {
      out[term] = value as string | string[]
    }
  }
  return out
}

/** Optional single value — string when present, `undefined` when absent. */
export function opt(node: Record<string, unknown>, key: string): string | undefined {
  return framedValue(node[key])
}

/**
 * Array value — set-container terms frame as string arrays, but the
 * accessor also absorbs scalar-or-array and literal-object members;
 * `[]` when absent.
 */
export function strs(node: Record<string, unknown>, key: string): string[] {
  const value = node[key]
  if (value === undefined || value === null) return []
  return (Array.isArray(value) ? value : [value]).map((item) => framedValue(item) ?? '')
}

/**
 * Find the `@id` of the first node in a JSON-LD document whose `@type`
 * includes `typeIri` — the JSON-LD replacement for
 * `getOneMatchingQuad(dataset, null, RDF.type, typeIri).subject`.
 * Throws when no such node exists.
 *
 * Matching is delegated to the framing algorithm: a frame with only
 * `{'@type': typeIri}` matches the FIRST node of that type as the focus —
 * single match frames as the node itself, multiple matches wrap in
 * `@graph`, none yields `{}` (docs/jsonld.md TODO 4).
 */
export async function findNodeIdByType(
  doc: unknown,
  typeIri: string,
  base?: string
): Promise<string> {
  // compactToRelative: false — frame() compacts its output against base by
  // default and would return relative @ids for absolute-id documents
  const options: any = { documentLoader, compactToRelative: false }
  if (base) options.base = base
  const framed = (await jsonld.frame(doc, { '@type': typeIri } as any, options)) as any
  const node = framed?.['@id'] ? framed : framed?.['@graph']?.[0]
  if (!node?.['@id']) throw new Error(`no node of type ${typeIri} in document`)
  return node['@id'] as string
}

/**
 * Collect the values of a predicate (as literal `@value` / node `@id`) across
 * every node of a JSON-LD document (expanded form, walked recursively).
 *
 * Replaces document-wide quad scans where the values live on other nodes than
 * the framed one (e.g. `interop:usesLanguage` on the description sets of an
 * access need document). The predicate is matched by its full IRI.
 */
export async function documentValues(
  doc: unknown,
  iri: string,
  predicate: string
): Promise<string[]> {
  const expanded = (await jsonld.expand(doc, { base: iri, documentLoader })) as any[]
  const values = new Set<string>()
  const nodes: any[] = []
  const collectNodes = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(collectNodes)
      return
    }
    if (value && typeof value === 'object') {
      nodes.push(value)
      for (const nested of Object.values(value)) collectNodes(nested)
    }
  }
  collectNodes(expanded)
  for (const node of nodes) {
    const matches = node[predicate]
    if (Array.isArray(matches)) {
      for (const match of matches) {
        if (typeof match === 'string') values.add(match)
        else if (typeof match?.['@value'] === 'string') values.add(match['@value'])
        else if (typeof match?.['@id'] === 'string') values.add(match['@id'])
      }
    }
  }
  return [...values]
}

/**
 * Convert a JSON-LD document (with embedded context) to an N3 Store.
 *
 * Uses jsonld.toRDF to convert the JSON-LD object directly to RDF quads
 * and collects them into an N3 Store.
 */
export async function toStore(doc: Record<string, unknown>, base?: string): Promise<Store> {
  const dataset = await jsonld.toRDF(doc, {
    base,
    documentLoader,
  })
  const store = new Store()
  for (const quad of dataset as unknown as Iterable<Quad>) {
    store.add(quad)
  }
  return store as Store
}

/**
 * Raw JSON-LD GET — returns the parsed document (expanded, compacted, or
 * flattened form). Throws if the request fails.
 */
export async function fetchJsonLd(iri: string, fetch: WhatwgFetch): Promise<unknown> {
  const response = await fetch(iri, {
    headers: { Accept: 'application/ld+json' },
  })
  if (!response.ok) {
    throw new Error(`failed to fetch ${iri}: ${response.status}`)
  }
  return response.json()
}

/**
 * Generic fetch+decode loader — the uniform `loadX` wrapper factory that
 * replaces the per-model `loadX = fromJsonLd(await fetchJsonLd(id, fetch), id)`
 * pairs (docs/jsonld.md TODO 6). The generic `T` is instantiated by inference
 * from `decode`'s return type at each use site; `WhatwgFetch` stays in the
 * factory signature, away from the model files:
 *
 * ```ts
 * export const loadRole = loader(fromJsonLd) // (id, fetch) => Promise<RoleData>
 * ```
 */
export function loader<T>(decode: (doc: unknown, id: string) => Promise<T>) {
  return async (id: string, fetch: WhatwgFetch): Promise<T> =>
    decode(await fetchJsonLd(id, fetch), id)
}

/**
 * Expand a JSON-LD document (with embedded context) to the expanded form —
 * full-IRI property keys, node references as `{ '@id' }`, literals as
 * `{ '@value' }` — with no `@context` on the result. The write path uses this
 * so PUT bodies carry no context (and are context-version-proof).
 */
export async function expandedJsonLd(doc: Record<string, unknown>): Promise<unknown[]> {
  return jsonld.expand(doc, { documentLoader }) as Promise<unknown[]>
}

/**
 * Raw JSON-LD PUT of a document — the body is sent in expanded form (see
 * `expandedJsonLd`; the document's embedded context is only used to expand).
 * Throws if the request fails. Extra headers (e.g. If-None-Match) can be
 * passed through.
 */
export async function putJsonLd(
  iri: string,
  fetch: WhatwgFetch,
  doc: Record<string, unknown>,
  headers?: Record<string, string>
): Promise<void> {
  const response = await fetch(iri, {
    method: 'PUT',
    body: JSON.stringify(await expandedJsonLd(doc)),
    headers: { 'Content-Type': 'application/ld+json', ...headers },
  })
  if (!response.ok) {
    throw new Error(`failed to put ${iri}: ${response.status}`)
  }
}

/**
 * Unwrap a value from framed JSON-LD output to a plain string.
 *
 * Plain strings pass through; language-tagged and typed literals frame to
 * `{ @value, @language }` / `{ @value, @type }` objects; node references
 * (IRI values without `@type: '@id'` coercion) frame to `{ id }` objects.
 */
export function framedValue(value: unknown): string | undefined {
  if (typeof value === 'string') return value
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>
    if (typeof obj['@value'] === 'string') return obj['@value']
    if (typeof obj.id === 'string') return obj.id
    if (typeof obj['@id'] === 'string') return obj['@id']
  }
  return undefined
}

/** Attach a context to a node POJO (used by the toJsonLd functions). */
export function withContext(
  context: JsonLdContext,
  node: Record<string, unknown>
): Record<string, unknown> {
  return {
    '@context': context,
    ...node,
  }
}
