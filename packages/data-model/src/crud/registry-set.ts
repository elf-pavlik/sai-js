import { INTEROP } from '@janeirodigital/interop-utils'
import type { AuthorizationAgentFactory } from '..'
import type { AgentRegistryData } from './agent-registry'
import type { AuthorizationRegistryData } from './authorization-registry'
import type { DataRegistryData } from './data-registry'
import type { GrantRegistryData } from './grant-registry'
import type { RoleRegistryData } from './role-registry'
import { fetchJsonLd, frameDoc, framedValue } from '../jsonld-utils'

const registrySetContext = {
  id: '@id',
  type: '@type',
  hasAgentRegistry: { '@id': INTEROP.hasAgentRegistry.value, '@type': '@id' },
  hasAuthorizationRegistry: {
    '@id': INTEROP.hasAuthorizationRegistry.value,
    '@type': '@id',
  },
  hasGrantRegistry: { '@id': INTEROP.hasGrantRegistry.value, '@type': '@id' },
  hasRoleRegistry: { '@id': INTEROP.hasRoleRegistry.value, '@type': '@id' },
  hasDataRegistry: {
    '@id': INTEROP.hasDataRegistry.value,
    '@type': '@id',
    '@container': '@set',
  },
}

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
  factory: AuthorizationAgentFactory
}

// ──────────────────────────
// Read path (creation happens at bootstrap in components/Account.ts)
// ──────────────────────────

export async function loadRegistrySet(
  iri: string,
  factory: AuthorizationAgentFactory
): Promise<RegistrySetData> {
  const doc = await fetchJsonLd(iri, factory.fetch.raw)
  const node = (await frameDoc(doc, registrySetContext, iri)) as any
  return {
    id: iri,
    type: node.type ? (Array.isArray(node.type) ? node.type : [node.type]) : [],
    hasAuthorizationRegistry: { id: framedValue(node.hasAuthorizationRegistry)! },
    hasGrantRegistry: { id: framedValue(node.hasGrantRegistry)! },
    hasAgentRegistry: { id: framedValue(node.hasAgentRegistry)! },
    hasRoleRegistry: { id: framedValue(node.hasRoleRegistry)! },
    hasDataRegistry: (node.hasDataRegistry ?? []).map((id: string) => ({ id })),
    factory,
  }
}
