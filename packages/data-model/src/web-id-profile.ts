import type { DatasetCore } from '@rdfjs/types'
import { Store } from 'n3'
import { frameDataset, frameDoc, framedValue, toStore, withContext } from './jsonld-utils'

const webIdProfileContext = {
  id: '@id',
  type: '@type',
  label: { '@id': 'http://www.w3.org/2000/01/rdf-schema#label' },
  oidcIssuer: { '@id': 'http://www.w3.org/ns/solid/terms#oidcIssuer' },
}

// ──────────────────────────
// Types
// ──────────────────────────

/** Plain JSON representation of a WebID profile document. */
export type WebIdProfileData = {
  id: string
  label?: string
  oidcIssuer?: string
}

// ──────────────────────────
// Read path: Dataset / JSON-LD → WebIdProfileData
// ──────────────────────────

/**
 * Convert a parsed RDF dataset into a WebIdProfileData POJO.
 * Uses jsonld.frame with the webIdProfileContext.
 */
export async function fromDataset(dataset: DatasetCore, iri: string): Promise<WebIdProfileData> {
  return compactNodeToWebIdProfileData((await frameDataset(dataset, webIdProfileContext, iri)) as any)
}

/**
 * Convert a JSON-LD document (fetched as application/ld+json) directly into a
 * WebIdProfileData POJO. The document can be in expanded, compacted, or
 * flattened form.
 */
export async function fromJsonLd(doc: unknown, iri: string): Promise<WebIdProfileData> {
  return compactNodeToWebIdProfileData((await frameDoc(doc, webIdProfileContext, iri)) as any)
}

function compactNodeToWebIdProfileData(node: any): WebIdProfileData {
  return {
    id: node.id ?? node['@id'],
    label: framedValue(node.label),
    oidcIssuer: framedValue(node.oidcIssuer),
  }
}

// ──────────────────────────
// Write path: WebIdProfileData → Dataset / JSON-LD
// ──────────────────────────

/** Convert a WebIdProfileData to an N3 Store (DatasetCore). */
export async function toDataset(data: WebIdProfileData): Promise<Store> {
  return toStore(toJsonLd(data), data.id)
}

/** Build a JSON-LD document (with embedded context) ready for PUT as application/ld+json. */
export function toJsonLd(data: WebIdProfileData): Record<string, unknown> {
  return withContext(webIdProfileContext, data)
}
