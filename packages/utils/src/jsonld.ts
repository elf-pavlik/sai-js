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
 */
export function buildFrame(context: JsonLdContext, iri: string): Record<string, unknown> {
  const frame: Record<string, unknown> = {
    '@context': context,
    '@id': iri,
  }
  for (const [key, val] of Object.entries(context)) {
    if (key === 'id' || key === 'type' || key === '@version') continue
    if (typeof val === 'object' && val !== null) {
      frame[key] = { '@embed': '@never', '@omitDefault': true }
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
  iri: string
): Promise<Record<string, unknown>> {
  const framed = await jsonld.frame(doc, buildFrame(context, iri) as any, { documentLoader })
  if (!(framed as any).id && !(framed as any)['@id']) {
    throw new Error(`Node ${iri} not found in framed output`)
  }
  return framed as Record<string, unknown>
}

/**
 * Find the `@id` of the first node in a JSON-LD document whose `@type`
 * includes `typeIri` — the JSON-LD replacement for
 * `getOneMatchingQuad(dataset, null, RDF.type, typeIri).subject`.
 * Throws when no such node exists.
 */
export async function findNodeIdByType(
  doc: unknown,
  typeIri: string,
  base?: string
): Promise<string> {
  const options: any = { documentLoader }
  if (base) options.base = base
  const expanded = (await jsonld.expand(doc, options)) as any[]
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
  const node = nodes.find((n) => (n['@type'] ?? []).includes(typeIri))
  if (!node) throw new Error(`no node of type ${typeIri} in document`)
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
