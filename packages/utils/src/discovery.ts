import { documentValues, fetchJsonLd } from './jsonld'
import {
  getAcl,
  getAgentRegistrationIri,
  getDescriptionResource,
  getStorageDescription,
} from './link-header'
import { INTEROP, NOTIFY } from './namespaces'
import type { WhatwgFetch } from './whatwg-fetch'

export class RequestError extends Error {
  constructor(
    message: string,
    public response: Response
  ) {
    super(message)
  }
}

export class AgentRegistrationDiscoveryError extends RequestError {
  constructor(public response: Response) {
    super('Discovery: Agent Registration - request failed', response)
  }
}

export class DescriptionResourceDiscoveryError extends RequestError {
  constructor(public response: Response) {
    super('Discovery: Resource Description - request failed', response)
  }
}

export class AccessResourceDiscoveryError extends RequestError {
  constructor(public response: Response) {
    super('Discovery: Access Resource - request failed', response)
  }
}

export class StorageDescriptionDiscoveryError extends RequestError {
  constructor(public response: Response) {
    super('Discovery: Storage Description - request failed', response)
  }
}

export async function discoverAuthorizationAgent(
  webId: string,
  fetch: WhatwgFetch
): Promise<string | undefined> {
  const doc = await fetchJsonLd(webId, fetch)
  return (await documentValues(doc, webId, INTEROP.hasAuthorizationAgent.value))[0]
}

export async function discoverDelegationIssuanceEndpoint(
  webId: string,
  fetch: WhatwgFetch
): Promise<string> {
  const uasId = await discoverAuthorizationAgent(webId, fetch)
  const doc = await fetchJsonLd(uasId, fetch)
  return (await documentValues(doc, uasId, INTEROP.hasDelegationIssuanceEndpoint.value))[0]
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

export async function discoverDescriptionResource(
  resourceIri: string,
  fetch: WhatwgFetch
): Promise<string | undefined> {
  const response = await fetch(resourceIri, { method: 'HEAD' })
  if (!response.ok) throw new DescriptionResourceDiscoveryError(response)
  const linkHeader = response.headers.get('Link')
  if (!linkHeader) return undefined
  return getDescriptionResource(linkHeader)
}

export async function discoverAccessResource(
  resourceIri: string,
  fetch: WhatwgFetch
): Promise<string | undefined> {
  const response = await fetch(resourceIri, { method: 'HEAD' })
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

export async function discoverAuthorizationRedirectEndpoint(
  authorizationAgentIri: string,
  fetch: WhatwgFetch
): Promise<string> {
  const doc = await fetchJsonLd(authorizationAgentIri, fetch)
  return (
    await documentValues(doc, authorizationAgentIri, INTEROP.hasAuthorizationRedirectEndpoint.value)
  )[0]!
}

export async function discoverWebPushService(
  authorizationAgentIri: string,
  fetch: WhatwgFetch
): Promise<{ id: string; vapidPublicKey: string } | undefined> {
  const doc = await fetchJsonLd(authorizationAgentIri, fetch)
  const [id] = await documentValues(doc, authorizationAgentIri, INTEROP.pushService.value)
  const [vapidPublicKey] = await documentValues(
    doc,
    authorizationAgentIri,
    NOTIFY.vapidPublicKey.value
  )
  if (!id || !vapidPublicKey) return
  return { id, vapidPublicKey }
}
