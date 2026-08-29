import { type WhatwgFetch, fetchJsonLd, frameDoc } from '@janeirodigital/interop-utils'
import { dataModelContext } from '../context'
import type { ActivityRegistryData } from './activity-registry'
import type { AgentRegistryData } from './agent-registry'
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
  hasAgentRegistry: AgentRegistryData
  hasRoleRegistry: RoleRegistryData
  hasDataRegistry: DataRegistryData[]
  /** present once the Activity Registry is seeded; producers throw without it */
  hasActivityRegistry?: ActivityRegistryData
}

// ──────────────────────────
// Read path (creation happens at bootstrap in components/Account.ts)
// ──────────────────────────

export async function loadRegistrySet(id: string, fetch: WhatwgFetch): Promise<RegistrySetData> {
  const doc = await fetchJsonLd(id, fetch)
  const node = (await frameDoc(doc, dataModelContext, id)) as any
  return {
    id: id,
    type: node.type ? (Array.isArray(node.type) ? node.type : [node.type]) : [],
    // @type: '@id' coerced — plain IRI strings
    hasAuthorizationRegistry: { id: node.hasAuthorizationRegistry },
    hasGrantRegistry: { id: node.hasGrantRegistry },
    hasAgentRegistry: { id: node.hasAgentRegistry },
    hasRoleRegistry: { id: node.hasRoleRegistry },
    hasDataRegistry: (node.hasDataRegistry ?? []).map((id: string) => ({ id })),
    hasActivityRegistry: node.hasActivityRegistry ? { id: node.hasActivityRegistry } : undefined,
  }
}
