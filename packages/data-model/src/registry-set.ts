import { frameNode, opt, str, strs } from '@janeirodigital/interop-utils'
import type { ActivityRegistryData } from './activity-registry'
import type {
  ApplicationRegistryData,
  InvitationRegistryData,
  SocialAgentRegistryData,
} from './agent-registry'
import type { AuthorizationRegistryData } from './authorization-registry'
import { dataModelContext } from './context'
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
  /** present once the AccessRequestRegistry is seeded (authorization-granting.md §6.3) */
  hasAccessRequestRegistry?: AccessRequestRegistryData
}

/** `interop:AccessRequestRegistry` — the owner's container of received
 *  need-based access requests (immutable resources). */
export type AccessRequestRegistryData = {
  id: string
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
  const node = await frameNode(doc, dataModelContext, id)
  // @type: '@id' coerced — plain IRI strings, wrapped in the XId shape
  const hasActivityRegistry = opt(node, 'hasActivityRegistry')
  const hasAccessRequestRegistry = opt(node, 'hasAccessRequestRegistry')
  return {
    id,
    type: node.type ?? [],
    hasAuthorizationRegistry: { id: str(node, 'hasAuthorizationRegistry') },
    hasGrantRegistry: { id: str(node, 'hasGrantRegistry') },
    hasSocialAgentRegistry: { id: str(node, 'hasSocialAgentRegistry') },
    hasApplicationRegistry: { id: str(node, 'hasApplicationRegistry') },
    hasInvitationRegistry: { id: str(node, 'hasInvitationRegistry') },
    hasRoleRegistry: { id: str(node, 'hasRoleRegistry') },
    hasDataRegistry: strs(node, 'hasDataRegistry').map((id) => ({ id })),
    hasActivityRegistry: hasActivityRegistry ? { id: hasActivityRegistry } : undefined,
    hasAccessRequestRegistry: hasAccessRequestRegistry
      ? { id: hasAccessRequestRegistry }
      : undefined,
  }
}
