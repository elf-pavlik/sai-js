import type { AuthorizationAgent } from '@janeirodigital/interop-authorization-agent'
import type { SocialAgentRegistrationData } from '@janeirodigital/interop-data-model'
import {
  INTEROP,
  fetchJsonLd,
  serializeTurtle,
  toStore,
  type WhatwgFetch,
} from '@janeirodigital/interop-utils'
import { arrayifyStream } from '@solid/community-server'
import { type IBindings, SparqlEndpointFetcher } from 'fetch-sparql-endpoint'
import { DataFactory, Store } from 'n3'

/**
 * Read-only local copies of peer-side registry data (org-context-sparql.md
 * phase 1).
 *
 * For every registration in the org's Agent Registry that carries a
 * `reciprocalRegistration` link, the mirror holds:
 *
 * - the reciprocal registration body (the peer's registration *of the org*)
 *   in a graph **named after the resource's own IRI** — the same IRI we
 *   would otherwise HTTP-GET;
 * - each data grant linked from it (`interop:hasDataGrant`) likewise in a
 *   graph named after its own IRI.
 *
 * This covers everything org-context reads would otherwise dereference on
 * the peer's server (where the admin's credentials match no ACR policy):
 * `buildSocialAgentProfile`, `getSocialAgents` pass 2, `findDataGrantIndex`,
 * `findGrantForResource`.
 *
 * **Single-writer invariant:** mirrors are written only by server-side sync
 * (webhook handler / invitation flow / unregister flow) using the ORG's
 * session; admin-facing code treats them strictly read-only.
 *
 * Phase 1: implemented but deliberately NOT wired. Call sites carry TODOs:
 * - `ReciprocalWebhookHandler` Update branch (peer-driven updates),
 * - invitation acceptance flow (initial mirror),
 * - unregister flow (`deleteReciprocalMirror`).
 */

const fetcher = new SparqlEndpointFetcher()

/** Fetch a resource with the given credentials and convert it to quads. */
async function fetchGraph(iri: string, fetch: WhatwgFetch): Promise<Store> {
  const doc = (await fetchJsonLd(iri, fetch)) as Record<string, unknown>
  return toStore(doc, iri)
}

const iriRef = DataFactory.namedNode

/**
 * Replace the mirror graphs for `registration.reciprocalRegistration` with
 * the current content fetched from the peer (using the session's
 * credentials — the org's own session when called from server-side flows).
 *
 * One SPARQL UPDATE per call: the reciprocal registration graph is always
 * DROPped and re-inserted — its body mutates (label, access-need links) and
 * its grant links are the drift signal. Grant graphs already present in the
 * mirror are neither re-fetched nor re-inserted: grants are immutable
 * (minted with a fresh IRI on change, unlinked on replace, DELETEd on
 * revocation), so "already mirrored" means "still current". Newly linked
 * grants are fetched and inserted; no-longer-linked ones are DROPped.
 * Idempotent — re-running produces the same store content.
 *
 * Crash-safety: everything before the single UPDATE is reads + an in-memory
 * diff, so a worker failure at any await leaves no partial state and the
 * activity re-runs from scratch. Writes replace whole graphs (never patch),
 * so concurrent writers converge last-writer-wins per graph; the residual
 * race is a stale-drop from an older snapshot dropping a graph a concurrent
 * newer sync just re-linked — healed by the next sync (plan phase 4b
 * serializes syncs per (webId, peerId) via workflowId).
 */
export async function updateReciprocalMirror(
  saiSession: AuthorizationAgent,
  registration: SocialAgentRegistrationData,
  sparqlEndpoint: string
): Promise<void> {
  const reciprocalIri = registration.reciprocalRegistration
  if (!reciprocalIri) throw new Error(`registration ${registration.id} has no reciprocal`)

  const registrationStore = await fetchGraph(reciprocalIri, saiSession.fetch)

  const grantIris = registrationStore
    .getObjects(iriRef(reciprocalIri), INTEROP.terms.hasDataGrant, null)
    .map((term) => term.value)

  // Existence oracle: the mirror's reciprocal graph lists the grants the last
  // sync wrote, and reciprocal + grants are written in one atomic UPDATE — so
  // a grant already listed there is still current and can be skipped (the
  // reciprocal graph is re-inserted with the full current link set every run,
  // keeping the oracle valid). Only newly linked grants need a peer fetch.
  const mirroredGrantIris = await mirroredGrants(sparqlEndpoint, reciprocalIri)
  const mirroredGrantSet = new Set(mirroredGrantIris)

  // set-difference both ways: newly linked grants (fresh ∖ mirrored) need a
  // peer fetch + insert; no-longer-linked ones (mirrored ∖ fresh) get
  // dropped. `Set.prototype.difference` is ES2025 — needs Node ≥ 22 (worker
  // runs node:24); fallback would be filter + has().
  const grantIrisSet = new Set(grantIris)
  const toInsert = [...grantIrisSet.difference(mirroredGrantSet)]
  const staleGraphs = [...mirroredGrantSet.difference(grantIrisSet)]

  const grantStores = new Map<string, Store>()
  for (const grantIri of toInsert) {
    grantStores.set(grantIri, await fetchGraph(grantIri, saiSession.fetch))
  }

  const drops = [reciprocalIri, ...staleGraphs]
    .map((iri) => `DROP SILENT GRAPH <${iri}>;`)
    .join('\n')

  const inserts: string[] = []
  for (const [graphIri, store] of [[reciprocalIri, registrationStore], ...grantStores] as const) {
    inserts.push(`GRAPH <${graphIri}> { ${await serializeTurtle(store)} }`)
  }

  await fetcher.fetchUpdate(
    sparqlEndpoint,
    `${drops}\nINSERT DATA {\n${inserts.join('\n')}\n}`
  )
}

/** Grant graphs currently mirrored for `reciprocalIri`. */
async function mirroredGrants(sparqlEndpoint: string, reciprocalIri: string): Promise<string[]> {
  const bindingsStream = await fetcher.fetchBindings(
    sparqlEndpoint,
    `SELECT ?grant WHERE {
  GRAPH <${reciprocalIri}> {
    <${reciprocalIri}> <${INTEROP.hasDataGrant}> ?grant .
  }
}`
  )
  const bindings = await arrayifyStream<IBindings>(bindingsStream)
  return bindings.map((binding) => binding.grant.value)
}

/**
 * Drop the mirror graphs of `registration.reciprocalRegistration` — the
 * registration graph and every grant graph still linked in it. Needs no
 * credentials: it only ever removes data this org mirrored itself.
 */
export async function deleteReciprocalMirror(
  registration: SocialAgentRegistrationData,
  sparqlEndpoint: string
): Promise<void> {
  const reciprocalIri = registration.reciprocalRegistration
  if (!reciprocalIri) return

  const grantIris = await mirroredGrants(sparqlEndpoint, reciprocalIri)
  const drops = [reciprocalIri, ...grantIris]
    .map((iri) => `DROP SILENT GRAPH <${iri}>;`)
    .join('\n')
  await fetcher.fetchUpdate(sparqlEndpoint, drops)
}
