import { readFileSync } from 'node:fs'
import * as jsonldNs from 'jsonld'
import { DataFactory, Parser, type Quad, type Term } from 'n3'

// CJS/ESM interop — same pattern as utils' jsonld.ts.
const jsonld = (jsonldNs as any).default ?? jsonldNs

// The css-storage-fixture registry TriG. Each GRAPH is a resource document;
// `meta:*` graphs carry the resource's rdf:type / properties (the CSS
// container description resource), the plain graph the resource itself.
const registryTrig = readFileSync(
  new URL('../../../css-storage-fixture/test/registry.trig', import.meta.url),
  'utf-8'
)

// Keep the parser's quad array (document order) — the N3 Store reorders quads
// internally (numeric-id indexes), which would scramble multi-valued output.
const registryQuads = new Parser({ format: 'application/trig' }).parse(registryTrig)

/** Unique key for a term — distinct for literals with the same lexical value
 * but different language / datatype. */
function termKey(term: Term): string {
  return `${term.termType}|${term.value}|${term.language}|${(term as any).datatype?.value ?? ''}`
}

/**
 * Build an expanded JSON-LD document — the shape a GET with
 * Accept: application/ld+json returns — from one or more named graphs of the
 * registry fixture (see packages/test-utils/src/data.json for the same shape).
 *
 * Quads are deduplicated (an RDF graph is a set; the fixture repeats the same
 * containment in the meta and resource graphs of a container) and flattened to
 * the default graph so `fromRDF` yields a flat node array like `data.json`.
 */
export async function docFromGraphs(graphIris: string[]): Promise<unknown[]> {
  const seen = new Set<string>()
  const quads: Quad[] = []
  for (const quad of registryQuads) {
    if (!graphIris.includes(quad.graph.value)) continue
    const quadKey = [quad.subject, quad.predicate, quad.object].map(termKey).join('|')
    if (seen.has(quadKey)) continue
    seen.add(quadKey)
    // strip the graph component -> default graph (flat expanded doc)
    quads.push(DataFactory.quad(quad.subject, quad.predicate, quad.object))
  }
  return jsonld.fromRDF(quads)
}
