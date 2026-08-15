import { fetchJsonLd, frameDoc } from '@janeirodigital/interop-utils'
import type { AuthorizationAgentFactory } from '..'
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
  factory: AuthorizationAgentFactory
}

// ──────────────────────────
// Read path (creation happens at bootstrap in components/Account.ts)
// ──────────────────────────

export async function loadRegistrySet(
  iri: string,
  factory: AuthorizationAgentFactory
): Promise<RegistrySetData> {
  const doc = await fetchJsonLd(iri, factory.fetch)
  const node = (await frameDoc(doc, dataModelContext, iri)) as any
  return {
    id: iri,
    type: node.type ? (Array.isArray(node.type) ? node.type : [node.type]) : [],
    // @type: '@id' coerced — plain IRI strings
    hasAuthorizationRegistry: { id: node.hasAuthorizationRegistry },
    hasGrantRegistry: { id: node.hasGrantRegistry },
    hasAgentRegistry: { id: node.hasAgentRegistry },
    hasRoleRegistry: { id: node.hasRoleRegistry },
    hasDataRegistry: (node.hasDataRegistry ?? []).map((id: string) => ({ id })),
    hasActivityRegistry: node.hasActivityRegistry ? { id: node.hasActivityRegistry } : undefined,
    factory,
  }
}
