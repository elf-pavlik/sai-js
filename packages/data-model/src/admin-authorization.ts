import { type WhatwgFetch, fetchJsonLd, frameDoc, withContext } from '@janeirodigital/interop-utils'
import { dataModelContext } from './context'

// ──────────────────────────
// Types
// ──────────────────────────

/** Identity + marking fields of an AdminAuthorization resource (R1 admin marker). */
export type AdminAuthorizationData = {
  id: string

  /** rdf:type IRIs — captured from framing on read, written on PUT */
  type: string[]

  grantee: string
  grantedBy: string
  scopeOfAuthorization: string
}

// ──────────────────────────
// Read path: JSON-LD → AdminAuthorizationData
// ──────────────────────────

/**
 * Convert a JSON-LD document (fetched as application/ld+json) directly into an
 * AdminAuthorizationData POJO.
 *
 * The document can be in expanded, compacted, or flattened form.
 */
export async function fromJsonLd(doc: unknown, id: string): Promise<AdminAuthorizationData> {
  const node = (await frameDoc(doc, dataModelContext, id)) as any
  return {
    id,
    type: node.type ? (Array.isArray(node.type) ? node.type : [node.type]) : [],
    grantee: node.grantee,
    grantedBy: node.grantedBy,
    scopeOfAuthorization: node.scopeOfAuthorization,
  }
}

/** Fetch and load an AdminAuthorization resource as an AdminAuthorizationData POJO. */
export async function loadAdminAuthorization(
  id: string,
  fetch: WhatwgFetch
): Promise<AdminAuthorizationData> {
  return fromJsonLd(await fetchJsonLd(id, fetch), id)
}

// ──────────────────────────
// Write path: AdminAuthorizationData → JSON-LD
// ──────────────────────────

/**
 * Build a JSON-LD document (with embedded context) ready for PUT as
 * application/ld+json — the PUT itself is the AA session's job.
 */
export function toJsonLd(data: AdminAuthorizationData): Record<string, unknown> {
  return withContext(dataModelContext, data)
}