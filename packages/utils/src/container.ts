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

/** The `rel="type"` link that makes a POST create a container. */
export const LWS_CONTAINER_LINK = '<https://www.w3.org/ns/lws#Container>; rel="type"'
