import { frameNode, selectNode } from '@janeirodigital/interop-utils'
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

const DATA_REGISTRATION_TERMS = ['registeredShapeTree', 'contains']

/**
 * Convert a JSON-LD document (fetched as application/ld+json) directly into a
 * DataRegistrationData POJO. The document can be in expanded, compacted, or
 * flattened form.
 */
export async function fromJsonLd(doc: unknown, id: string): Promise<DataRegistrationData> {
  return selectNode(
    await frameNode(doc, dataModelContext, id),
    DATA_REGISTRATION_TERMS
  ) as unknown as DataRegistrationData
}
