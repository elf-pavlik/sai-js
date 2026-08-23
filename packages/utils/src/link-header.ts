import LinkHeader from 'http-link-header'
import { INTEROP, SOLID } from './namespaces'

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

export function getStorageDescription(linkHeaderText: string): string | undefined {
  const links = LinkHeader.parse(linkHeaderText).refs
  return links.find((link) => link.rel === SOLID.storageDescription)?.uri
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
