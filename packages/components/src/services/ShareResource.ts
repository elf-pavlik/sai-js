import {
  type AuthorizationAgent,
  type ShareDataInstanceStructure,
  matchesScope,
} from '@janeirodigital/interop-authorization-agent'
import {
  ActivityRegistry,
  computeChildren,
  loadDataInstance,
  setAccessNeedGroup,
} from '@janeirodigital/interop-authorization-agent'
import {
  type AuthorizationRecorded,
  type DataAuthorizationData,
  type DataInstanceData,
  DataRegistration,
  ShapeTree,
  isBlob,
  labelFromNode,
  loadClientIdDocument,
  loadShapeTree,
} from '@janeirodigital/interop-data-model'
import { INTEROP } from '@janeirodigital/interop-utils'
import {
  IRI,
  Resource,
  type ShareAuthorization,
  type ShareAuthorizationConfirmation,
} from '@janeirodigital/sai-api-messages'
import type * as S from 'effect/Schema'
import {
  findSocialAgentRegistrationInContext,
  listSocialAgentRegistrations,
} from './SocialAgentRegistry.js'
import type { ResolvedContext } from './Context.js'
import { fetchPeerDocument, peerInstanceNode } from './peerProxy.js'
import { getDataAuthorization, listContained, sparqlTransportFor } from './queries/org.js'

/**
 * Grantees whose org-side data authorizations cover the resource — the
 * org-context counterpart of `AA.findAgentsWithAccess`, evaluated over the
 * ORG's authorization registry (via SPARQL) instead of the session's own.
 * Pure — exported for unit tests; the scope rule itself is the AA's
 * `matchesScope`.
 */
export function agentsWithAccessMatching(
  authorizations: DataAuthorizationData[],
  resource: DataInstanceData,
  ownerWebId: string
): string[] {
  const agents = new Set<string>()
  for (const authorization of authorizations) {
    if (authorization.registeredShapeTree !== resource.shapeTreeIri) continue
    if (matchesScope(authorization, resource, ownerWebId)) agents.add(authorization.grantee)
  }
  return [...agents]
}

/**
 * "Who has access": data authorizations of the *context* authorization
 * registry, matched like `AA.findAgentsWithAccess` (with `ctx.webId` as the
 * owner), filtered to agents registered with the context. Reads via SPARQL
 * (`queries/org.ts`) — personal context via the session's internal endpoint,
 * org context over `/sparql-admin` (`sparqlTransportFor`); the admin session
 * HTTP-derefs no peer document and holds no data grants.
 */
async function orgAgentsWithAccess(
  ctx: ResolvedContext,
  resource: DataInstanceData
): Promise<string[]> {
  const transport = sparqlTransportFor(ctx)
  const authorizationIris = await listContained(
    transport,
    ctx.registrySet.hasAuthorizationRegistry.id
  )
  const authorizations = await Promise.all(
    authorizationIris.map((iri) => getDataAuthorization(transport, iri))
  )
  const agents = agentsWithAccessMatching(authorizations, resource, ctx.webId)
  const registered = new Set(
    (await listSocialAgentRegistrations(ctx)).map((registration) => registration.registeredAgent)
  )
  return agents.filter((agent) => registered.has(agent))
}

/**
 * Org-context data-instance read: the instance (+ its registration) are
 * peer data — the admin's session holds no grants on the peer's server, so
 * both docs are fetched through `/proxy-admin` (the org's server fetches
 * with the org's session) and framed from the fetched docs. Shape trees
 * are public and stay on the admin-session factory. JSON-LD only: blob
 * instances are out of scope (their description-resource HEAD is not
 * proxied).
 */
async function orgContextDataInstance(
  ctx: ResolvedContext,
  iri: string,
  lang: string
): Promise<DataInstanceData> {
  const registrationIri = `${iri.split('/').slice(0, -1).join('/')}/`
  const registration = await DataRegistration.fromJsonLd(
    await fetchPeerDocument(ctx.session, ctx.webId, registrationIri),
    registrationIri
  )
  const shapeTree = await loadShapeTree(registration.registeredShapeTree, ctx.session.fetch)
  const node = await peerInstanceNode(ctx, iri, shapeTree)
  return {
    id: iri,
    shapeTreeIri: registration.registeredShapeTree,
    label: labelFromNode(node),
    isBlob: isBlob(shapeTree),
    dataRegistration: registration,
    children: await computeChildren(node, shapeTree, ctx.session.fetch, lang),
  }
}

export const getResource = async (ctx: ResolvedContext, id: string, lang: string) => {
  const resource = await (ctx.webId === ctx.userWebId
    ? loadDataInstance(id, ctx.session.fetch, undefined, lang)
    : orgContextDataInstance(ctx, id, lang))
  if (!resource) throw new Error(`Resource not found: ${id}`)
  const shapeTree = await loadShapeTree(resource.shapeTreeIri!, ctx.session.fetch)
  const shapeTreeDescription = await ShapeTree.getDescription(shapeTree, lang, ctx.session.fetch)
  // "who has access" is read via SPARQL in both contexts — personal via
  // the session's internal endpoint, org via `/sparql-admin`
  // (`sparqlTransportFor`).
  const accessGrantedTo = await orgAgentsWithAccess(ctx, resource)
  return Resource.make({
    id: IRI.make(resource.id),
    label: resource.label,
    shapeTree: {
      id: IRI.make(resource.shapeTreeIri!),
      label: shapeTreeDescription?.label,
    },
    accessGrantedTo: accessGrantedTo.map((agent) => IRI.make(agent)),
    children: resource.children.map((child) => ({
      shapeTree: {
        id: IRI.make(child.shapeTree.id),
        label: child.shapeTree.label,
      },
      count: child.count,
    })),
  })
}

export const shareResource = async (
  ctx: ResolvedContext,
  shareAuthorization: S.Schema.Type<typeof ShareAuthorization>
): Promise<S.Schema.Type<typeof ShareAuthorizationConfirmation>> => {
  // the RPC shape is structurally identical to the AA's domain structure —
  // explicit field copies (kills the previous `as unknown as` cast)
  const structure: ShareDataInstanceStructure = {
    applicationId: shareAuthorization.applicationId,
    resource: shareAuthorization.resource,
    agents: [...shareAuthorization.agents],
    accessMode: [...shareAuthorization.accessMode],
    children: shareAuthorization.children.map((child) => ({
      shapeTree: child.shapeTree,
      accessMode: [...child.accessMode],
    })),
  }
  // `shareDataInstance` writes on the session's own registry set — in an org
  // context (unexercised) it would target the user's; out of the phase-3
  // exercised scope, tracked as debt.
  const recorded = await ctx.session.shareDataInstance(structure)

  const clientIdDocument = await loadClientIdDocument(
    shareAuthorization.applicationId,
    ctx.session.fetch
  )

  // grantees are social agents in the share flow (roles are not share targets)
  const grantees = [...new Set(recorded.map((dataAuthorization) => dataAuthorization.grantee))]

  // one authorizationRecorded activity per deduped grantee → one notification,
  // one workflow per grantee (sequential PUTs — CSS SPARQL backend races on
  // concurrent PUTs in the same container). Parties ride the object: the
  // recorded DataAuthorizations (live-link set) carry the grantee.
  const activityRegistry = ctx.registrySet.hasActivityRegistry
  if (!activityRegistry) throw new Error('activity registry not found in registry set')
  for (const grantee of grantees) {
    const activity: Omit<AuthorizationRecorded, 'id'> = {
      type: ['Activity', 'AuthorizationRecorded'],
      actor: ctx.webId,
      target: ctx.registrySet.hasAuthorizationRegistry.id,
      object: recorded
        .filter((dataAuthorization) => dataAuthorization.grantee === grantee)
        .map((dataAuthorization) => dataAuthorization.id),
      createdAt: new Date().toISOString(),
    }
    await ActivityRegistry.createActivity(
      activityRegistry,
      { fetch: ctx.session.fetch, randomUUID: ctx.session.randomUUID },
      activity
    )
  }

  return {
    callbackEndpoint: clientIdDocument.callbackEndpoint!,
  }
}

export async function requestAccessUsingApplicationNeeds(
  ctx: ResolvedContext,
  applicationIri: string,
  webId: string
): Promise<void> {
  const socialAgentRegistration = await findSocialAgentRegistrationInContext(ctx, webId)
  const clientIdDocument = await loadClientIdDocument(applicationIri, ctx.session.fetch)
  await setAccessNeedGroup(
    socialAgentRegistration,
    ctx.session.fetch,
    clientIdDocument.hasAccessNeedGroup
  )
}
