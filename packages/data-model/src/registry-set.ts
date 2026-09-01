import { type WhatwgFetch, fetchJsonLd, frameDoc } from '@janeirodigital/interop-utils'
import { dataModelContext } from './context'
import type { ActivityRegistryData } from './activity-registry'
import type {
  ApplicationRegistryData,
  InvitationRegistryData,
  SocialAgentRegistryData,
} from './agent-registry'
import type { AuthorizationRegistryData } from './authorization-registry'
import type { DataRegistryData } from './data-registry'
import type { GrantRegistryData } from './grant-registry'
import type { RoleRegistryData } from './role-registry'

// ──────────────────────────
// Types
// ──────────────────────────

export type RegistrySetData = {
  id: string
  /** rdf:type IRIs — captured from framing on read */
  type: string[]
  hasAuthorizationRegistry: AuthorizationRegistryData
  hasGrantRegistry: GrantRegistryData
  hasSocialAgentRegistry: SocialAgentRegistryData
  hasApplicationRegistry: ApplicationRegistryData
  hasInvitationRegistry: InvitationRegistryData
  hasRoleRegistry: RoleRegistryData
  hasDataRegistry: DataRegistryData[]
  /** present once the Activity Registry is seeded; producers throw without it */
  hasActivityRegistry?: ActivityRegistryData
}

// ──────────────────────────
// Read path (creation happens at bootstrap in components/Account.ts)
// ──────────────────────────

/**
 * Convert a JSON-LD document (fetched as application/ld+json) directly into a
 * RegistrySetData POJO. The document can be in expanded, compacted, or
 * flattened form.
 */
export async function fromJsonLd(doc: unknown, id: string): Promise<RegistrySetData> {
  const node = (await frameDoc(doc, dataModelContext, id)) as any
  return {
    id: id,
    type: node.type ? (Array.isArray(node.type) ? node.type : [node.type]) : [],
    // @type: '@id' coerced — plain IRI strings
    hasAuthorizationRegistry: { id: node.hasAuthorizationRegistry },
    hasGrantRegistry: { id: node.hasGrantRegistry },
    hasSocialAgentRegistry: { id: node.hasSocialAgentRegistry },
    hasApplicationRegistry: { id: node.hasApplicationRegistry },
    hasInvitationRegistry: { id: node.hasInvitationRegistry },
    hasRoleRegistry: { id: node.hasRoleRegistry },
    hasDataRegistry: (node.hasDataRegistry ?? []).map((id: string) => ({ id })),
    hasActivityRegistry: node.hasActivityRegistry ? { id: node.hasActivityRegistry } : undefined,
  }
}

export async function loadRegistrySet(id: string, fetch: WhatwgFetch): Promise<RegistrySetData> {
  return fromJsonLd(await fetchJsonLd(id, fetch), id)
}
