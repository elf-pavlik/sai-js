import type { AuthorizationAgent } from '@janeirodigital/interop-authorization-agent'
import {
  DataRegistration,
  Grant,
  type GrantData,
  type ShapeTreeData,
  childIris,
  frameDataInstanceFromDoc,
  loadDataRegistration,
  loadShapeTree,
} from '@janeirodigital/interop-data-model'
import { INTEROP, discoverAuthorizationAgent } from '@janeirodigital/interop-utils'
import type { ResolvedContext } from './Context.js'

/**
 * Raised by `fetchPeerDocument` when the org's AA cannot be discovered,
 * the proxy request fails, or the target IRI is not http(s). Carries the
 * upstream status when there is one. Listed in `.componentsignore` — not
 * instantiable as a Components.js component.
 */
export class PeerProxyError extends Error {
  constructor(
    message: string,
    public readonly status?: number
  ) {
    super(message)
    this.name = 'PeerProxyError'
  }
}

/**
 * Admin-side client for `/.sai/proxy-admin` (org-context-proxy.md): the
 * org-context RPC services fetch a peer resource — a data registration or
 * a data instance document — **through the org's server** instead of
 * dereferencing it directly. The admin holds no data grants on the peer's
 * server (credentials match nothing), and the admin's server never holds
 * the org's session, so the fetch has to happen on the org's server with
 * the org's credentials.
 *
 * Discovers the org's AA IRI (its server hosts the `.sai` API), builds
 * `/.sai/proxy-admin/<base64url-org>?iri=<target>`, and GETs it with the
 * **admin's** session credentials (the only session the admin's server
 * holds). The org's server gates the request as an admin
 * (`requireOrgAdmin`) and performs the upstream fetch with the org's
 * session (`fetchPeerResource`).
 *
 * JSON-LD only, mirroring the endpoint contract.
 *
 * @returns the parsed JSON-LD document
 * @throws PeerProxyError with the upstream status on non-ok responses
 */
export async function fetchPeerDocument(
  adminSession: AuthorizationAgent,
  orgWebId: string,
  targetIri: string
): Promise<unknown> {
  let orgAA: string | undefined
  try {
    orgAA = await discoverAuthorizationAgent(orgWebId, adminSession.fetch)
  } catch {
    throw new PeerProxyError(`cannot discover authorization agent for ${orgWebId}`)
  }
  if (!orgAA) {
    throw new PeerProxyError(`cannot discover authorization agent for ${orgWebId}`)
  }
  let base: string
  try {
    base = new URL(orgAA).origin
  } catch {
    throw new PeerProxyError(`invalid authorization agent IRI for ${orgWebId}: ${orgAA}`)
  }
  const orgSegment = Buffer.from(orgWebId).toString('base64url')
  const url = `${base}/.sai/proxy-admin/${orgSegment}?iri=${encodeURIComponent(targetIri)}`

  const response = await adminSession.fetch(url, {
    headers: { Accept: 'application/ld+json' },
  })
  if (!response.ok) {
    throw new PeerProxyError(
      `upstream ${response.status} for ${targetIri}: ${await response.text()}`,
      response.status
    )
  }
  return response.json()
}

/**
 * The `contains` of a data registration, resolved with the right
 * credentials for the context (org-context-proxy.md). Personal context
 * derefs directly with the user's own session (the user holds the
 * peer's data grants); org context goes through `/proxy-admin` with the
 * admin's session — the admin holds no data grants on the peer's server.
 *
 * Used by the `getDescriptions` `AllFromRegistry` counts and by
 * `peerInstanceIris`'s `AllFromRegistry` branch.
 */
export async function dataRegistrationContains(
  ctx: ResolvedContext,
  registrationIri: string
): Promise<string[]> {
  if (ctx.webId === ctx.userWebId) {
    return (await loadDataRegistration(registrationIri, ctx.session.fetch)).contains
  }
  const doc = await fetchPeerDocument(ctx.session, ctx.webId, registrationIri)
  return (await DataRegistration.fromJsonLd(doc, registrationIri)).contains
}

/**
 * Frame an already-fetched peer data instance document. The doc comes
 * from `fetchPeerDocument` (org context) or a personal-context fetch;
 * the shape tree is a public resource fetched with the caller's session.
 */
export async function peerInstanceNode(
  ctx: ResolvedContext,
  instanceIri: string,
  shapeTree: ShapeTreeData
): Promise<Record<string, unknown>> {
  return frameDataInstanceFromDoc(
    await fetchPeerDocument(ctx.session, ctx.webId, instanceIri),
    instanceIri,
    shapeTree
  )
}

/**
 * Data-instance IRIs covered by a peer data grant in **org context** — the
 * counterpart of `Grant.getDataInstanceIterator` (which derefs peer docs
 * with the session's factory — the admin holds no data grants → 403):
 * `contains` via `dataRegistrationContains`, `SelectedFromRegistry` from
 * grant metadata, and `Inherited` walks the parent grant and the parent
 * instance content, all through `/proxy-admin`. Personal context keeps
 * `Grant.getDataInstanceIterator`.
 */
export async function* peerInstanceIris(
  ctx: ResolvedContext,
  dataGrant: GrantData
): AsyncIterable<string> {
  switch (dataGrant.scopeOfGrant) {
    case INTEROP.AllFromRegistry:
      yield* await dataRegistrationContains(ctx, dataGrant.hasDataRegistration)
      break
    case INTEROP.SelectedFromRegistry:
      yield* dataGrant.hasDataInstance ?? []
      break
    case INTEROP.Inherited: {
      // the parent grant lives in the peer's registry — refetched here via
      // the proxy (SAPI supports one level of inheritance today)
      const parentGrant = await Grant.fromJsonLd(
        await fetchPeerDocument(ctx.session, ctx.webId, dataGrant.inheritsFromGrant!),
        dataGrant.inheritsFromGrant!
      )
      for await (const parentIri of peerInstanceIris(ctx, parentGrant)) {
        const parentShapeTree = await loadShapeTree(
          parentGrant.registeredShapeTree,
          ctx.session.fetch
        )
        yield* childIris(
          await peerInstanceNode(ctx, parentIri, parentShapeTree),
          parentShapeTree,
          dataGrant.registeredShapeTree
        )
      }
      break
    }
    default:
      throw new Error(`Unknown scope: ${dataGrant.scopeOfGrant}`)
  }
}
