import { frameNode, selectNode, withContext } from '@janeirodigital/interop-utils'
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

const ADMIN_AUTHORIZATION_TERMS = ['grantee', 'grantedBy', 'scopeOfAuthorization']

/**
 * Convert a JSON-LD document (fetched as application/ld+json) directly into an
 * AdminAuthorizationData POJO.
 *
 * The document can be in expanded, compacted, or flattened form.
 */
export async function fromJsonLd(doc: unknown, id: string): Promise<AdminAuthorizationData> {
  return selectNode(
    await frameNode(doc, dataModelContext, id),
    ADMIN_AUTHORIZATION_TERMS
  ) as unknown as AdminAuthorizationData
}

/** Fetch and load an AdminAuthorization resource as an AdminAuthorizationData POJO. */

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
