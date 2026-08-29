import { INTEROP, RDF, type WhatwgFetch } from '@janeirodigital/interop-utils'
import { DataFactory, Store } from 'n3'
import { linkedIrisJsonLd } from './context'
import { iriForContained as containerIriForContained, createContainer } from './container'

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
  fetch: WhatwgFetch
): Promise<string[]> {
  return linkedIrisJsonLd(data.id, fetch, 'contains')
}

export async function getGranted(
  data: AuthorizationRegistryData,
  fetch: WhatwgFetch
): Promise<boolean> {
  return (await getDataAuthorizationIris(data, fetch)).length > 0
}

// ──────────────────────────
// Registry container (AdminAuthorization resources live in ../admin-authorization)
// ──────────────────────────

export async function createAuthorizationRegistry(
  data: AuthorizationRegistryData,
  fetch: WhatwgFetch
): Promise<void> {
  const dataset = new Store()
  dataset.add(
    DataFactory.quad(
      DataFactory.namedNode(data.id),
      RDF.terms.type,
      INTEROP.terms.AuthorizationRegistry
    )
  )
  await createContainer(data.id, fetch, dataset)
}

export function iriForContained(
  data: AuthorizationRegistryData,
  randomUUID: () => string,
  container = false
): string {
  return containerIriForContained(data.id, randomUUID, container)
}
