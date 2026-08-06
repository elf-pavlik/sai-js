import { type WhatwgFetch } from '@janeirodigital/interop-utils'
import type { AuthorizationAgentFactory } from '.'
import { createContainer } from './crud/container'
import { fetchJsonLd, frameDoc, toStore, withContext } from './jsonld-utils'

const dataRegistrationContext = {
  id: '@id',
  type: '@type',
  registeredShapeTree: {
    '@id': 'http://www.w3.org/ns/solid/interop#registeredShapeTree',
    '@type': '@id',
  },
  contains: {
    '@id': 'http://www.w3.org/ns/ldp#contains',
    '@type': '@id',
    '@container': '@set',
  },
}

// ──────────────────────────
// Types
// ──────────────────────────

/** Plain JSON representation of a Data Registration. */
export type DataRegistrationData = {
  id: string
  /** rdf:type IRIs — captured from framing on read, written on create */
  type: string[]
  registeredShapeTree: string
  /** Resources contained in the registration (LDP containment, server-managed). */
  contains: string[]
}

// ──────────────────────────
// Read path: JSON-LD → DataRegistrationData
// ──────────────────────────

/**
 * Convert a JSON-LD document (fetched as application/ld+json) directly into a
 * DataRegistrationData POJO. The document can be in expanded, compacted, or
 * flattened form.
 */
export async function fromJsonLd(doc: unknown, iri: string): Promise<DataRegistrationData> {
  const node = (await frameDoc(doc, dataRegistrationContext, iri)) as any
  return {
    id: node.id ?? node['@id'],
    type: node.type ? (Array.isArray(node.type) ? node.type : [node.type]) : [],
    registeredShapeTree: node.registeredShapeTree,
    contains: node.contains ?? [],
  }
}

export async function loadDataRegistration(
  iri: string,
  fetch: WhatwgFetch
): Promise<DataRegistrationData> {
  return fromJsonLd(await fetchJsonLd(iri, fetch), iri)
}

// ──────────────────────────
// Write path: DataRegistrationData → container (container.create)
// ──────────────────────────

export async function createDataRegistration(
  data: DataRegistrationData,
  factory: AuthorizationAgentFactory
): Promise<void> {
  // build the dataset via jsonld.toRDF (withContext + toStore) — the rdf:type
  // quads come from data.type (no hand-built DataFactory quads); only the
  // container.create hand-off (PUT empty container + SPARQL patch of the
  // description resource) stays N3-based in the container module
  const dataset = await toStore(withContext(dataRegistrationContext, data), data.id)
  await createContainer(data.id, factory, dataset)
}
