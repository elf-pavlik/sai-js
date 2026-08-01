import type { DatasetCore, Quad } from '@rdfjs/types'
import * as jsonldNs from 'jsonld'
import { Store } from 'n3'

// CJS/ESM interop: jsonld is a CJS package; in the ESM bundle the namespace
// has the full exports only on .default.  Grab the full object so that all
// properties (fromRDF, compact, toRDF, expand, …) are available.
const jsonld = (jsonldNs as any).default ?? jsonldNs

export type JsonLdContext = Record<string, unknown>

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
      frame[key] = { '@embed': '@never' }
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
  const framed = await jsonld.frame(doc, buildFrame(context, iri) as any)
  if (!(framed as any).id && !(framed as any)['@id']) {
    throw new Error(`Node ${iri} not found in framed output`)
  }
  return framed as Record<string, unknown>
}

/**
 * Convert a JSON-LD document (with embedded context) to an N3 Store.
 *
 * Uses jsonld.toRDF to convert the JSON-LD object directly to RDF quads
 * and collects them into an N3 Store. The resulting dataset can be passed
 * directly to an RdfFetch call as the `dataset` option (the wrapper
 * serializes it to turtle).
 */
export async function toStore(doc: Record<string, unknown>, base?: string): Promise<Store> {
  const dataset = await jsonld.toRDF(doc, {
    base,
  })
  const store = new Store()
  for (const quad of dataset as unknown as Iterable<Quad>) {
    store.add(quad)
  }
  return store as Store
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
