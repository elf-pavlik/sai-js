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
