import {
  INTEROP,
  LDP,
  RDF,
  type WhatwgFetch,
  createContainer,
  iriForContained,
  linkedIrisJsonLd,
} from '@janeirodigital/interop-utils'
import { DataFactory, Store } from 'n3'

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
  return linkedIrisJsonLd(data.id, fetch, LDP.contains)
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
