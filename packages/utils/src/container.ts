import { expandedJsonLd } from './jsonld.ts'
import { applyPatch, insertPatch } from './sparql-update.ts'
import type { WhatwgFetch } from './whatwg-fetch.ts'

/**
 * Suffixes of Solid auxiliary resources (access control, description). They are
 * not container members: Solid §4.3 discovers them through the subject's Link
 * header, and container representations filter them out of `ldp:contains`.
 */
const AUXILIARY_PATH = /\.(?:acr|acl|meta)$/

/**
 * True for an auxiliary resource IRI (`.acr` / `.acl` access control, `.meta`
 * description). The flat LWS store in CSS ≤ `01ad3376` records `lws:contains`
 * for an auxiliary when it is created, so raw containment listings (HTTP and
 * the SPARQL `meta:` graph alike) can contain auxiliary members that must not
 * be loaded as contained resources.
 */
export function isAuxiliaryResource(iri: string): boolean {
  return AUXILIARY_PATH.test(iri.split(/[?#]/u)[0])
}

/**
 * Generate an IRI for a resource contained in the given container. `data` is
 * any object carrying the container IRI in its `id` field (typically a
 * registry or container POJO).
 *
 * Hierarchical storage only: flat LWS storage ignores containment for
 * identification, see `flatMemberIri`.
 */
export function iriForContained(
  data: { id: string },
  randomUUID: () => string,
  container = false
): string {
  let containedIri = `${data.id}${randomUUID()}`
  if (container) containedIri += '/'
  return containedIri
}

/** The `rel="type"` link that makes a POST create a container (LWS: containers are identified by metadata, no trailing slash). */
export const LWS_CONTAINER_LINK = '<https://www.w3.org/ns/lws#Container>; rel="type"'

/**
 * The `slug`/`Location` identifier for a member created through POST: flat
 * storage honors a UUID slug and allocates `{storageRoot}{uuid}` — the member's
 * URI is independent of its containment (LWS, §Resource Identification), so
 * pre-minted IRIs must be built from the STORAGE ROOT, not from the container.
 * Containers have no trailing slash either.
 */
export function flatMemberIri(storageRoot: string, uuid: string): string {
  const root = storageRoot.endsWith('/') ? storageRoot : `${storageRoot}/`
  return `${root}${uuid}`
}

/**
 * The storage root a registry container belongs to: registries sit one level
 * below the registry pod's root (`https://registry/<owner>/<registry>/`), so
 * the root is the container IRI without its last path segment.
 */
export function registryStorageRoot(registryContainerIri: string): string {
  const trimmed = registryContainerIri.replace(/\/$/u, '')
  const cut = trimmed.lastIndexOf('/')
  if (cut < 0) throw new Error(`cannot derive a storage root from ${registryContainerIri}`)
  return `${trimmed.slice(0, cut + 1)}`
}

/**
 * Pre-minted flat IRI for a registry member: `{registryPodRoot}{uuid}`. The
 * member's URI is independent of the registry it is contained in (LWS,
 * §Resource Identification), and `postMember` throws when the server allocates
 * anything else, so a different pod layout fails loudly instead of silently
 * writing to an unexpected IRI.
 */
export function registryMemberIri(registryContainerIri: string, uuid: string): string {
  return flatMemberIri(registryStorageRoot(registryContainerIri), uuid)
}

/** Scheme-agnostic IRI comparison: flat members never carry a trailing slash. */
function trimTrailingSlash(iri: string): string {
  return iri.replace(/\/$/u, '')
}

/** Options for `postMember`. */
export interface PostMemberOptions {
  /** Create a container (LWS `Container` link; body is ignored by the store). */
  container?: boolean
  /** Extra request headers (merged over the defaults). */
  headers?: Record<string, string>
}

/**
 * Create a resource at its pre-minted flat IRI: POST the representation to the
 * containing registry with the identifier's UUID as `Slug`. The flat store
 * records `lws:contains` on that container and `lws:partOf` on the member, and
 * honors the slug, so the allocated `Location` MUST be the pre-minted IRI —
 * a mismatch is thrown, never silently written to an unexpected URI.
 *
 * Containers ignore the body (the store keeps container metadata only); the
 * caller populates their description with `createContainer`'s PATCH half via
 * `populateContainerDescription`.
 */
export async function postMember(
  containerIri: string,
  fetch: WhatwgFetch,
  member: { id: string; body?: unknown },
  options: PostMemberOptions = {}
): Promise<string> {
  const uuid = member.id.split('/').filter(Boolean).pop()
  if (!uuid) throw new Error(`cannot derive a slug from ${member.id}`)
  const headers: Record<string, string> = { slug: uuid, ...options.headers }
  if (options.container) headers.link = LWS_CONTAINER_LINK
  const hasContentType = Object.keys(headers).some((name) => name.toLowerCase() === 'content-type')
  if (!hasContentType) headers['content-type'] = 'application/ld+json'

  // same wire form as `putJsonLd`: expanded JSON-LD, no embedded context
  const body =
    member.body === undefined
      ? undefined
      : JSON.stringify(await expandedJsonLd(member.body as Record<string, unknown>))
  const response = await fetch(containerIri, {
    method: 'POST',
    headers,
    body,
  })
  if (!response.ok) {
    throw new Error(`failed to POST ${member.id} to ${containerIri}: ${response.status}`)
  }
  const location = response.headers.get('Location')
  if (!location) throw new Error(`POST ${containerIri} did not return a Location`)
  const created = new URL(location, containerIri).toString()
  if (trimTrailingSlash(created) !== trimTrailingSlash(member.id)) {
    throw new Error(
      `POST ${containerIri} allocated ${created}, expected the pre-minted ${member.id} ` +
        '(is the storage root part of the member IRI?)'
    )
  }
  // containers keep metadata only — the POST body is ignored, so populate the
  // container description explicitly
  if (options.container && member.body) {
    await applyPatch(created, fetch, await insertPatch(member.body as Record<string, unknown>))
  }
  return created
}

/**
 * Create a resource with POST and a Slug, returning the server-assigned IRI.
 *
 * Flat LWS storage allocates every new resource directly under the storage
 * root (the target container only selects the storage), so the resource IRI
 * must come from the `Location` header instead of being minted from the
 * container path. Pass `link` to create a container (`<lws:Container>;
 * rel="type"`).
 */
export async function postForIri(
  containerIri: string,
  fetch: WhatwgFetch,
  slug: string,
  init: { headers?: Record<string, string>; body?: BodyInit } = {}
): Promise<string> {
  const headers: Record<string, string> = { slug, ...init.headers }
  const hasContentType = Object.keys(headers).some((name) => name.toLowerCase() === 'content-type')
  if (!hasContentType) {
    // CSS rejects a POST without a Content-Type; an empty JSON-LD document
    // creates the resource without triples (callers PUT the body afterwards).
    headers['content-type'] = 'application/ld+json'
  }
  const response = await fetch(containerIri, {
    method: 'POST',
    headers,
    body: init.body ?? '[]',
  })
  if (!response.ok) {
    throw new Error(`failed to POST ${containerIri}: ${response.status}`)
  }
  const location = response.headers.get('Location')
  if (!location) {
    throw new Error(`POST ${containerIri} did not return a Location`)
  }
  return new URL(location, containerIri).toString()
}

/**
 * Create a container and populate its description resource via a SPARQL patch.
 *
 * Community Solid Server ignores the PUT body when creating containers, so
 * creation is: PUT an empty container, discover its description resource
 * (HEAD + Link header), then PATCH the description resource with the given
 * JSON-LD document serialized as `INSERT DATA { ... }`.
 */
export async function createContainer(
  id: string,
  fetch: WhatwgFetch,
  doc: Record<string, unknown>
): Promise<void> {
  // create empty container, CSS ignores body!
  const response = await fetch(id, { method: 'PUT' })
  if (!response.ok) {
    console.error(response)
    throw new Error('failed to create empty container')
  }

  await applyPatch(id, fetch, await insertPatch(doc))
}
