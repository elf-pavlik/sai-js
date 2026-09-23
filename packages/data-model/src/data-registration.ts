import { frameNode, str, strs } from '@janeirodigital/interop-utils'
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
  const node = await frameNode(doc, dataModelContext, id)
  return {
    id: node.id ?? node['@id'],
    type: node.type ?? [],
    registeredShapeTree: str(node, 'registeredShapeTree'),
    contains: strs(node, 'contains'),
  }
}
