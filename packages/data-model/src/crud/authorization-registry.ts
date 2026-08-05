import { INTEROP, LDP, RDF } from '@janeirodigital/interop-utils'
import { DataFactory, Store } from 'n3'
import type { AuthorizationAgentFactory, DataAuthorizationData } from '..'
import { CRUDContainer, iriForContained as containerIriForContained } from './container'
import { linkedIris } from './resource'

// ──────────────────────────
// Types
// ──────────────────────────

export type AuthorizationRegistryData = {
  id: string
}

// ──────────────────────────
// Functional helpers for reading the contained data authorizations
// ──────────────────────────

export async function getDataAuthorizationIris(
  data: AuthorizationRegistryData,
  factory: AuthorizationAgentFactory
): Promise<string[]> {
  return linkedIris(data.id, factory, LDP.contains)
}

export async function getGranted(
  data: AuthorizationRegistryData,
  factory: AuthorizationAgentFactory
): Promise<boolean> {
  return (await getDataAuthorizationIris(data, factory)).length > 0
}

export async function getDataAuthorizations(
  data: AuthorizationRegistryData,
  factory: AuthorizationAgentFactory
): Promise<DataAuthorizationData[]> {
  const iris = await getDataAuthorizationIris(data, factory)
  return Promise.all(iris.map((iri) => factory.readable.dataAuthorization(iri)))
}

// ──────────────────────────
// Behavior functions (replacing class methods)
// ──────────────────────────

export async function* dataAuthorizations(
  data: AuthorizationRegistryData,
  factory: AuthorizationAgentFactory
): AsyncIterable<DataAuthorizationData> {
  const iris = await getDataAuthorizationIris(data, factory)
  for (const iri of iris) {
    yield factory.readable.dataAuthorization(iri)
  }
}

export async function findDataAuthorizations(
  data: AuthorizationRegistryData,
  factory: AuthorizationAgentFactory,
  grantee: string
): Promise<DataAuthorizationData[]> {
  const matching: DataAuthorizationData[] = []
  for await (const dataAuthorization of dataAuthorizations(data, factory)) {
    if (dataAuthorization.grantee === grantee) {
      matching.push(dataAuthorization)
    }
  }
  return matching
}

export async function findAuthorizationsDelegatingFromOwner(
  data: AuthorizationRegistryData,
  factory: AuthorizationAgentFactory,
  dataOwner: string,
  roleId: string
): Promise<DataAuthorizationData[]> {
  const matching: DataAuthorizationData[] = []
  for await (const dataAuthorization of dataAuthorizations(data, factory)) {
    let matches = false
    // exclude authorizations where dataOwner is also the grantee (it would match when All scope)
    if (dataAuthorization.grantee !== dataOwner) {
      if (dataAuthorization.dataOwner === dataOwner) {
        matches = true
      }
      if (!roleId && dataAuthorization.scopeOfAuthorization === INTEROP.All.value) {
        matches = true
      }
    }
    if (matches) {
      matching.push(dataAuthorization)
    }
  }
  return matching
}

export async function createAuthorizationRegistry(
  data: AuthorizationRegistryData,
  factory: AuthorizationAgentFactory
): Promise<void> {
  const dataset = new Store()
  dataset.add(
    DataFactory.quad(DataFactory.namedNode(data.id), RDF.type, INTEROP.AuthorizationRegistry)
  )
  const container = new CRUDContainer(data.id, factory, {})
  container.dataset = dataset
  await container.create()
}

export function iriForContained(
  data: AuthorizationRegistryData,
  factory: AuthorizationAgentFactory,
  container = false
): string {
  return containerIriForContained(data.id, factory, container)
}
