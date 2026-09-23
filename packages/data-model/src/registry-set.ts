import { frameNode } from '@janeirodigital/interop-utils'
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

export type RegistrySetData = {
  id: string
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

export type AccessRequestRegistryData = {
  id: string
}

const REGISTRY_SET_TERMS = [
  'hasAuthorizationRegistry',
  'hasGrantRegistry',
  'hasSocialAgentRegistry',
  'hasApplicationRegistry',
  'hasInvitationRegistry',
  'hasRoleRegistry',
  'hasDataRegistry',
  'hasActivityRegistry',
  'hasAccessRequestRegistry',
] as const

/**
 * Convert a JSON-LD document (fetched as application/ld+json) directly into a
 * RegistrySetData POJO. The document can be in expanded, compacted, or
 * flattened form.
 */
export async function fromJsonLd(doc: unknown, id: string): Promise<RegistrySetData> {
  const node = await frameNode(doc, dataModelContext, id)
  return {
    id,
    type: node.type ?? [],
    hasAuthorizationRegistry: { id: node.hasAuthorizationRegistry as string },
    hasGrantRegistry: { id: node.hasGrantRegistry as string },
    hasSocialAgentRegistry: { id: node.hasSocialAgentRegistry as string },
    hasApplicationRegistry: { id: node.hasApplicationRegistry as string },
    hasInvitationRegistry: { id: node.hasInvitationRegistry as string },
    hasRoleRegistry: { id: node.hasRoleRegistry as string },
    hasDataRegistry: ((node.hasDataRegistry as string[] | undefined) ?? []).map((id) => ({ id })),
    hasActivityRegistry: node.hasActivityRegistry
      ? { id: node.hasActivityRegistry as string }
      : undefined,
    hasAccessRequestRegistry: node.hasAccessRequestRegistry
      ? { id: node.hasAccessRequestRegistry as string }
      : undefined,
  }
}
