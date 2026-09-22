import { frameNode, loader, opt } from '@janeirodigital/interop-utils'
import { dataModelContext } from './context'

// ──────────────────────────
// Types
// ──────────────────────────

/** Identity of a WebID profile document. */
export type WebIdProfileId = {
  id: string
  /** rdf:type IRIs — captured from framing on read */
  type: string[]
}

/** Plain JSON representation of a WebID profile document. */
export type WebIdProfileData = WebIdProfileId & {
  label?: string
  oidcIssuer?: string
}

// ──────────────────────────
// Read path: JSON-LD → WebIdProfileData
// ──────────────────────────

/**
 * Convert a JSON-LD document (fetched as application/ld+json) directly into a
 * WebIdProfileData POJO. The document can be in expanded, compacted, or
 * flattened form.
 */
export async function fromJsonLd(doc: unknown, id: string): Promise<WebIdProfileData> {
  const node = await frameNode(doc, dataModelContext, id)
  return {
    id: node.id ?? node['@id'],
    type: node.type ?? [],
    // skos:prefLabel — literal; oidcIssuer — node reference (@type: '@id' coerced)
    label: opt(node, 'label'),
    oidcIssuer: opt(node, 'oidcIssuer'),
  }
}

export const loadWebIdProfile = loader(fromJsonLd)
