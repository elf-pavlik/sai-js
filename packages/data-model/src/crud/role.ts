import {
  type WhatwgFetch,
  fetchJsonLd,
  frameDoc,
  putJsonLd,
  withContext,
} from '@janeirodigital/interop-utils'
import { dataModelContext } from '../context'

// ──────────────────────────
// Types
// ──────────────────────────

export type RoleId = {
  id: string
  /** rdf:type IRIs — captured from framing on read, written via compaction on write */
  type: string[]
}

export type RoleData = RoleId & {
  prefLabel: string
  members: string[]
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
export async function fromJsonLd(doc: unknown, id: string): Promise<RoleData> {
  const node = (await frameDoc(doc, dataModelContext, id)) as any
  return {
    id: id,
    type: node.type ? (Array.isArray(node.type) ? node.type : [node.type]) : [],
    prefLabel: node.prefLabel ?? '',
    members: node.members ?? [],
  }
}

export async function loadRole(id: string, fetch: WhatwgFetch): Promise<RoleData> {
  return fromJsonLd(await fetchJsonLd(id, fetch), id)
}

// ──────────────────────────
// Write path: RoleData → JSON-LD (PUT)
// ──────────────────────────

export async function putRole(data: RoleData, fetch: WhatwgFetch): Promise<void> {
  await putJsonLd(data.id, fetch, withContext(dataModelContext, data))
}
