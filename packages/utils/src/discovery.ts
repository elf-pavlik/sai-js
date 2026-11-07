import { documentValues, fetchJsonLd, findNodeIdByType } from './jsonld.ts'
import {
  getAcl,
  getAgentRegistrationIri,
  getDescriptionResource,
  getLwsStorage,
  getStorageDescription,
} from './link-header.ts'
import { INTEROP, NOTIFY, SPACE } from './namespaces.ts'
import type { WhatwgFetch } from './whatwg-fetch.ts'

export class RequestError extends Error {
  response: Response

  constructor(message: string, response: Response) {
    super(message)
    this.response = response
  }
}

export class AgentRegistrationDiscoveryError extends RequestError {
  constructor(response: Response) {
    super('Discovery: Agent Registration - request failed', response)
  }
}

export class DescriptionResourceDiscoveryError extends RequestError {
  constructor(response: Response) {
    super('Discovery: Resource Description - request failed', response)
  }
}

export class AccessResourceDiscoveryError extends RequestError {
  constructor(response: Response) {
    super('Discovery: Access Resource - request failed', response)
  }
}

export class StorageDescriptionDiscoveryError extends RequestError {
  constructor(response: Response) {
    super('Discovery: Storage Description - request failed', response)
  }
}

export async function discoverAuthorizationAgent(
  webId: string,
  fetch: WhatwgFetch
): Promise<string | undefined> {
  const doc = await fetchJsonLd(webId, fetch)
  return (await documentValues(doc, webId, INTEROP.hasAuthorizationAgent))[0]
}

export async function discoverDelegationIssuanceEndpoint(
  webId: string,
  fetch: WhatwgFetch
): Promise<string> {
  const uasId = await discoverAuthorizationAgent(webId, fetch)
  if (!uasId) throw new Error(`cannot discover authorization agent for ${webId}`)
  const doc = await fetchJsonLd(uasId, fetch)
  return (await documentValues(doc, uasId, INTEROP.hasDelegationIssuanceEndpoint))[0]
}

export async function discoverAgentRegistration(
  authorizationAgentIri: string,
  fetch: WhatwgFetch
): Promise<string | undefined> {
  const response = await fetch(authorizationAgentIri, { method: 'HEAD' })
  if (!response.ok) throw new AgentRegistrationDiscoveryError(response)
  const linkHeader = response.headers.get('Link')
  if (!linkHeader) return undefined
  return getAgentRegistrationIri(linkHeader)
}

/**
 * `Accept` for auxiliary-resource discovery HEADs (`rel="acl"`,
 * `rel="describedby"`). A concrete type is required: a **storage root**
 * answers a wildcard-only (or absent) `Accept` with the public LWS storage
 * description (`application/lws+cid`, `wildcardDescribes`), and that response
 * carries no auxiliary links — only the root container representation does
 * (see `LwsStorageDescriptionHandler`). Registry sets and pods are storage
 * roots under flat LWS, so this affects every registry-set ACL lookup. The
 * low-quality wildcard keeps non-RDF resources discoverable.
 */
export const AUXILIARY_DISCOVERY_ACCEPT = 'text/turtle, application/ld+json;q=0.9, */*;q=0.1'

export async function discoverDescriptionResource(
  resourceIri: string,
  fetch: WhatwgFetch
): Promise<string | undefined> {
  const response = await fetch(resourceIri, {
    method: 'HEAD',
    headers: { Accept: AUXILIARY_DISCOVERY_ACCEPT },
  })
  if (!response.ok) throw new DescriptionResourceDiscoveryError(response)
  const linkHeader = response.headers.get('Link')
  if (!linkHeader) return undefined
  return getDescriptionResource(linkHeader)
}

export async function discoverAccessResource(
  resourceIri: string,
  fetch: WhatwgFetch
): Promise<string | undefined> {
  const response = await fetch(resourceIri, {
    method: 'HEAD',
    headers: { Accept: AUXILIARY_DISCOVERY_ACCEPT },
  })
  if (!response.ok) throw new AccessResourceDiscoveryError(response)
  const linkHeader = response.headers.get('Link')
  if (!linkHeader) return undefined
  return getAcl(linkHeader)
}

export async function discoverStorageDescription(
  resourceIri: string,
  fetch: WhatwgFetch
): Promise<string | undefined> {
  const response = await fetch(resourceIri, { method: 'HEAD' })
  if (!response.ok) throw new StorageDescriptionDiscoveryError(response)
  const linkHeader = response.headers.get('Link')
  if (!linkHeader) return undefined
  return getStorageDescription(linkHeader)
}

/** Media type of the LWS storage description resource (LWS, §Discovery and Binding). */
export const LWS_STORAGE_DESCRIPTION_ACCEPT = 'application/lws+cid'

/** The service type of the storage root in the LWS storage description. */
const LWS_STORAGE_ROOT_TYPES = ['StorageRoot', 'https://www.w3.org/ns/lws#StorageRoot']

/**
 * Discovers the storage a resource belongs to through the LWS `storage` link
 * relation (LWS, §Discovery and Binding).
 */
export async function discoverLwsStorage(
  resourceIri: string,
  fetch: WhatwgFetch
): Promise<string | undefined> {
  const response = await fetch(resourceIri, { method: 'HEAD' })
  if (!response.ok) return undefined
  const linkHeader = response.headers.get('Link')
  if (!linkHeader) return undefined
  return getLwsStorage(linkHeader)
}

/** Fetches the LWS storage description (`application/lws+cid`). */
export async function fetchLwsStorageDescription(
  storage: string,
  fetch: WhatwgFetch
): Promise<Record<string, unknown> | undefined> {
  const response = await fetch(storage, {
    headers: { Accept: LWS_STORAGE_DESCRIPTION_ACCEPT },
  })
  if (!response.ok) return undefined
  const contentType = response.headers.get('Content-Type') ?? ''
  if (!contentType.includes(LWS_STORAGE_DESCRIPTION_ACCEPT)) return undefined
  return (await response.json()) as Record<string, unknown>
}

/**
 * Resolves the storage root of a resource through LWS discovery:
 * `rel="https://www.w3.org/ns/lws#storage"` → storage description → the
 * `StorageRoot` service entry.
 */
export async function lwsStorageRoot(
  resourceIri: string,
  fetch: WhatwgFetch
): Promise<string | undefined> {
  const storage = await discoverLwsStorage(resourceIri, fetch)
  if (!storage) return undefined
  const description = await fetchLwsStorageDescription(storage, fetch)
  if (!description) return undefined
  const rawServices = description.service
  const services = Array.isArray(rawServices) ? rawServices : rawServices ? [rawServices] : []
  for (const service of services) {
    if (!service || typeof service !== 'object') continue
    const record = service as Record<string, unknown>
    const types = Array.isArray(record.type) ? record.type : [record.type]
    if (!types.some((type) => LWS_STORAGE_ROOT_TYPES.includes(type as string))) continue
    if (typeof record.serviceEndpoint === 'string') {
      return new URL(record.serviceEndpoint, storage).href
    }
  }
  return undefined
}

/**
 * Resolve the storage IRI behind a container or registry. Prefers LWS
 * discovery (`rel="storage"` → `StorageRoot` service) and falls back to the
 * Solid storage description + `space:Storage` node for servers that only
 * speak Solid. `data` carries the container IRI in its `id` field.
 */
export async function storageIri(data: { id: string }, fetch: WhatwgFetch): Promise<string> {
  const lws = await lwsStorageRoot(data.id, fetch).catch(() => undefined)
  if (lws) return lws
  const storageDescriptionIri = await discoverStorageDescription(data.id, fetch)
  if (!storageDescriptionIri) {
    throw new Error(`cannot discover storage description for ${data.id}`)
  }
  const doc = await fetchJsonLd(storageDescriptionIri, fetch)
  return findNodeIdByType(doc, SPACE.Storage, storageDescriptionIri)
}

export async function discoverAuthorizationRedirectEndpoint(
  authorizationAgentIri: string,
  fetch: WhatwgFetch
): Promise<string> {
  const doc = await fetchJsonLd(authorizationAgentIri, fetch)
  return (
    await documentValues(doc, authorizationAgentIri, INTEROP.hasAuthorizationRedirectEndpoint)
  )[0]!
}

export async function discoverWebPushService(
  authorizationAgentIri: string,
  fetch: WhatwgFetch
): Promise<{ id: string; vapidPublicKey: string } | undefined> {
  const doc = await fetchJsonLd(authorizationAgentIri, fetch)
  const [id] = await documentValues(doc, authorizationAgentIri, INTEROP.pushService)
  const [vapidPublicKey] = await documentValues(doc, authorizationAgentIri, NOTIFY.vapidPublicKey)
  if (!id || !vapidPublicKey) return
  return { id, vapidPublicKey }
}
