import { type WhatwgFetch, fetchJsonLd, frameDoc } from '@janeirodigital/interop-utils'
import { dataModelContext } from './context'

// ──────────────────────────
// Types
// ──────────────────────────

/** Identity of a data registration. */
export type DataRegistrationId = {
  id: string
  /** rdf:type IRIs — captured from framing on read, written on create */
  type: string[]
}

/** Plain JSON representation of a Data Registration. */
export type DataRegistrationData = DataRegistrationId & {
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
export async function fromJsonLd(doc: unknown, id: string): Promise<DataRegistrationData> {
  const node = (await frameDoc(doc, dataModelContext, id)) as any
  return {
    id: node.id ?? node['@id'],
    type: node.type ? (Array.isArray(node.type) ? node.type : [node.type]) : [],
    registeredShapeTree: node.registeredShapeTree,
    contains: node.contains ?? [],
  }
}

export async function loadDataRegistration(
  id: string,
  fetch: WhatwgFetch
): Promise<DataRegistrationData> {
  return fromJsonLd(await fetchJsonLd(id, fetch), id)
}
