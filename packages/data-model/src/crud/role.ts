import { type WhatwgFetch } from '@janeirodigital/interop-utils'
import { dataModelContext } from '../context'
import { fetchJsonLd, frameDoc, putJsonLd, withContext } from '../jsonld-utils'

// ──────────────────────────
// Types
// ──────────────────────────

export type RoleData = {
  id: string
  prefLabel: string
  members: string[]
  /** rdf:type IRIs — captured from framing on read, written via compaction on write */
  type: string[]
}

// ──────────────────────────
// Read path: JSON-LD → RoleData
// ──────────────────────────

/**
 * Convert a JSON-LD document (fetched as application/ld+json) directly into a RoleData POJO.
 *
 * The document can be in expanded, compacted, or flattened form.
 * Uses jsonld.frame with the shared data model context: `members` is coerced
 * to a string array via @type: @id + @container: @set, `prefLabel` to a plain
 * string, and the rdf:type (from framing) to a string array.
 */
export async function fromJsonLd(doc: unknown, iri: string): Promise<RoleData> {
  const node = (await frameDoc(doc, dataModelContext, iri)) as any
  return {
    id: iri,
    type: node.type ? (Array.isArray(node.type) ? node.type : [node.type]) : [],
    prefLabel: node.prefLabel ?? '',
    members: node.members ?? [],
  }
}

export async function loadRole(
  iri: string,
  fetch: WhatwgFetch
): Promise<RoleData> {
  return fromJsonLd(await fetchJsonLd(iri, fetch), iri)
}

// ──────────────────────────
// Write path: RoleData → JSON-LD (PUT)
// ──────────────────────────

export async function putRole(
  data: RoleData,
  fetch: WhatwgFetch
): Promise<void> {
  await putJsonLd(data.id, fetch, withContext(dataModelContext, data))
}
