import LinkHeader from 'http-link-header'

import { INTEROP, LWS, SOLID } from './namespaces.ts'

export function getAgentRegistrationIri(linkHeaderText: string): string | undefined {
  const links = LinkHeader.parse(linkHeaderText).refs
  return links.find((link) => link.rel === INTEROP.registeredAgent)?.anchor
}

/**
 * `<registrySet>; rel="http://www.w3.org/ns/solid/interop#hasRegistrySet"`
 * — served by AgentIdHandler to admins of the org (Phase 2, org-admin-feature.md).
 */
export function getRegistrySetIri(linkHeaderText: string): string | undefined {
  const links = LinkHeader.parse(linkHeaderText).refs
  return links.find((link) => link.rel === INTEROP.hasRegistrySet)?.uri
}

export function getDescriptionResource(linkHeaderText: string): string | undefined {
  const links = LinkHeader.parse(linkHeaderText).refs
  return links.find((link) => link.rel === 'describedby')?.uri
}

export function getAcl(linkHeaderText: string): string | undefined {
  const links = LinkHeader.parse(linkHeaderText).refs
  return links.find((link) => link.rel === 'acl')?.uri
}

/**
 * LWS, §Containment: every response to a GET/HEAD on a non-root resource
 * carries a `Link` with relation `up` pointing at its parent container — the
 * storage's **stored** `lws:partOf`, not a path guess. This is the flat-LWS
 * replacement for deriving the parent from the resource IRI.
 */
export function getUp(linkHeaderText: string): string | undefined {
  const links = LinkHeader.parse(linkHeaderText).refs
  return links.find((link) => link.rel === 'up')?.uri
}

export function getStorageDescription(linkHeaderText: string): string | undefined {
  const links = LinkHeader.parse(linkHeaderText).refs
  return links.find((link) => link.rel === SOLID.storageDescription)?.uri
}

/**
 * LWS, §Discovery and Binding: every response has a `Link` with relation
 * `https://www.w3.org/ns/lws#storage` pointing to the storage the resource
 * belongs to.
 */
export function getLwsStorage(linkHeaderText: string): string | undefined {
  const links = LinkHeader.parse(linkHeaderText).refs
  return links.find((link) => link.rel === LWS.storage)?.uri
}

export function getNotificationChannel(linkHeaderText: string): string | undefined {
  const links = LinkHeader.parse(linkHeaderText).refs
  return links.find((link) => link.rel === SOLID.updatesViaStreamingHttp2023)?.uri
}

export function targetDataRegistrationLink(dataRegistrationIri: string): string {
  const link = new LinkHeader()
  link.set({
    uri: dataRegistrationIri,
    rel: 'http://www.w3.org/ns/solid/interop#targetDataRegistration',
  })
  return link.toString()
}
