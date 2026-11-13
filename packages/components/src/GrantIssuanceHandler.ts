import {
  getRegistryGrants,
  grantChainValidity,
  localSparqlTransport,
} from '@janeirodigital/interop-authorization-agent'
import {
  Grant,
  type AccessRequestMessage,
  type FinalGrantData,
  type GrantData,
  type IncomingGrantData,
  type OdrlPolicy,
} from '@janeirodigital/interop-data-model'
import { discoverAuthorizationAgent } from '@janeirodigital/interop-utils'
import { INTEROP, LWS } from '@janeirodigital/interop-utils'
import {
  APPLICATION_JSON,
  BadRequestHttpError,
  BasicRepresentation,
  ForbiddenHttpError,
  OkResponseDescription,
  OperationHttpHandler,
  ResponseDescription,
  UnauthorizedHttpError,
  UnsupportedMediaTypeHttpError,
  readableToString,
} from '@solid/community-server'
import type { CredentialsExtractor, OperationHttpHandlerInput } from '@solid/community-server'
import { getLoggerFor } from 'global-logger-factory'

import { GrantRevocationHandler } from './GrantRevocationHandler.js'
import {
  isAccessRequestMessage,
  isAccessRevocationMessage,
  isNeedBasedAccessRequestMessage,
} from './messages.js'
import {
  acceptNeedBasedAccessRequest,
  isOdrlNeedBasedAccessRequest,
  needBasedAccessRequestFromOdrl,
} from './need-based-access-request.js'
import type { PodEndpointStore } from './PodEndpointStore.js'
import type { SessionManager } from './SessionManager'
import { Temporal } from './temporal/client.js'
import { storeGrant } from './temporal/workflows/grants.js'

/** The JSON-LD media type the whole endpoint now requires (§6.2). */
const LD_JSON_MEDIA_TYPE = 'application/ld+json'

function firstDataOwner(policy: OdrlPolicy): string {
  return policy.permission[0]?.assigner ?? ''
}

function grantFromPolicy(
  policy: OdrlPolicy,
  id: string,
  envelopeScope: string,
  index: number
): FinalGrantData {
  const permission = policy.permission[0]
  const target = permission?.target
  const instances = policy.permission
    .map((candidate) => candidate.target)
    .filter((candidate) => candidate.type.includes('http://www.w3.org/ns/odrl/2/Asset'))
    .map((candidate) => candidate.source[0])
    .filter(Boolean)
  const registration = target?.type.includes(INTEROP.DataRegistration)
    ? target.source[0]
    : (target?.partOf?.[0] ?? '')
  return {
    id,
    type: [LWS.AccessGrant],
    access: [policy],
    scopeOfGrant: policy.scopeOfGrant ?? envelopeScope,
    storage: target?.storage ?? '',
    dataOwner: permission?.assigner ?? '',
    grantedBy: permission?.requester ?? '',
    registeredShapeTree: policy.registeredShapeTree ?? '',
    hasDataRegistration: registration,
    ...(instances.length ? { hasDataInstance: instances } : {}),
    ...(index >= 0 ? {} : {}),
  }
}

export class GrantIssuanceHandler extends OperationHttpHandler {
  protected readonly logger = getLoggerFor(this)
  public constructor(
    private readonly credentialsExtractor: CredentialsExtractor,
    private readonly sessionManager: SessionManager,
    private readonly endpointStore: PodEndpointStore
  ) {
    super()
  }
  public async handle({
    operation,
    request,
  }: OperationHttpHandlerInput): Promise<ResponseDescription> {
    const credentials = await this.credentialsExtractor.handleSafe(request)
    if (!credentials.agent?.webId || !credentials.client?.clientId) {
      // missing credentials is an AUTHENTICATION failure — 401, not 403
      // (authorization-granting.md §6.2, codes decided 2026-09)
      throw new UnauthorizedHttpError()
    }
    // TODO: check if WebID served by this authz agent

    // the whole endpoint requires JSON-LD (authorization-granting.md §6.2 —
    // the WHOLE-endpoint gate, decided 2026-09; the delegation tests send
    // the header now)
    const contentType = operation.body.metadata.contentType?.toLowerCase() ?? ''
    if (
      contentType !== LD_JSON_MEDIA_TYPE &&
      contentType !== 'application/lws+json' &&
      !contentType.startsWith('application/ld+json;')
    ) {
      throw new UnsupportedMediaTypeHttpError(
        'expected application/ld+json or application/lws+json'
      )
    }

    const uasId = await discoverAuthorizationAgent(credentials.agent.webId, fetch)
    if (credentials.client.clientId !== uasId) {
      throw new ForbiddenHttpError()
    }

    // the delegation endpoint dispatches on the message `type`
    const message = await this.parseMessage(operation)
    if (Array.isArray(message)) {
      return this.issueDelegation(message, credentials, operation)
    }
    if (isOdrlNeedBasedAccessRequest(message)) {
      return acceptNeedBasedAccessRequest(
        this.sessionManager,
        needBasedAccessRequestFromOdrl(message, credentials.agent.webId),
        credentials.agent.webId
      )
    }
    if (isAccessRevocationMessage(message)) {
      return new GrantRevocationHandler(this.endpointStore, this.sessionManager).revoke(
        message,
        credentials,
        operation
      )
    }
    if (isNeedBasedAccessRequestMessage(message)) {
      return acceptNeedBasedAccessRequest(this.sessionManager, message, credentials.agent.webId)
    }
    if (!isAccessRequestMessage(message)) {
      throw new BadRequestHttpError('invalid delegation message')
    }
    return this.issue(message, credentials, operation)
  }

  /**
   * New ODRL delegation payload: a top-level array of parent-tree request
   * envelopes. Each policy becomes its own final grant; `inheritsFromGrant`
   * policy links are remapped to the minted HTTPS grant IRIs.
   */
  private async issueDelegation(
    envelopes: unknown[],
    credentials: Awaited<ReturnType<CredentialsExtractor['handleSafe']>>,
    operation: OperationHttpHandlerInput['operation']
  ): Promise<ResponseDescription> {
    if (envelopes.length === 0) throw new BadRequestHttpError('delegation request is empty')
    const finalGrants: FinalGrantData[] = []
    const dataOwners = new Set<string>()
    for (const [index, raw] of envelopes.entries()) {
      if (typeof raw !== 'object' || raw === null) {
        throw new BadRequestHttpError('invalid delegation envelope')
      }
      const envelope = raw as Record<string, unknown>
      const tempId = `urn:uuid:${crypto.randomUUID()}`
      const normalized = await Grant.fromJsonLd({ ...envelope, id: tempId }, tempId)
      if (!normalized.access.length)
        throw new BadRequestHttpError('delegation envelope has no access')
      const byPolicyId = new Map<string, FinalGrantData>()
      for (const policy of normalized.access) {
        const grantId = await this.sessionManager
          .getSession(firstDataOwner(policy))
          .then((sai) => sai.mintIdentifier(sai.registrySet.hasGrantRegistry.id))
        const grant = grantFromPolicy(policy, grantId, normalized.scopeOfGrant, index)
        byPolicyId.set(policy.uid ?? policy.id ?? '', grant)
        dataOwners.add(grant.dataOwner)
        finalGrants.push(grant)
      }
      // remap policy-level inheritance to the minted grant IRIs
      for (const policy of normalized.access) {
        const grant = byPolicyId.get(policy.uid ?? policy.id ?? '')
        if (!grant) continue
        if (policy.inheritsFromGrant) {
          grant.inheritsFromGrant = byPolicyId.get(policy.inheritsFromGrant)?.id
        }
      }
      for (const policy of normalized.access) {
        const grant = byPolicyId.get(policy.uid ?? policy.id ?? '')
        if (!grant) continue
        const children = normalized.access
          .filter((candidate) => candidate.inheritsFromGrant === (policy.uid ?? policy.id))
          .map((candidate) => byPolicyId.get(candidate.uid ?? candidate.id ?? '')?.id)
          .filter((id): id is string => Boolean(id))
        if (children.length) grant.hasInheritingGrant = children
      }
    }
    if (dataOwners.size !== 1) {
      throw new BadRequestHttpError('all grants must have the same dataOwner')
    }
    const [dataOwner] = [...dataOwners]
    const sai = await this.sessionManager.getSession(dataOwner)
    await this.validateDelegable(finalGrants, credentials.agent.webId, sai)
    const temporal = new Temporal()
    await temporal.init()
    await temporal.client.workflow.execute(storeGrant, {
      taskQueue: 'create-grants',
      args: [finalGrants],
      workflowId: crypto.randomUUID(),
    })
    const doc = JSON.stringify(finalGrants)
    const representation = new BasicRepresentation(doc, operation.target, APPLICATION_JSON)
    return new OkResponseDescription(representation.metadata, representation.data)
  }

  private async issue(
    message: AccessRequestMessage,
    credentials: Awaited<ReturnType<CredentialsExtractor['handleSafe']>>,
    operation: OperationHttpHandlerInput['operation']
  ): Promise<ResponseDescription> {
    const { grants } = message
    if (grants.length === 0) {
      throw new BadRequestHttpError('AccessRequest requires at least one grant')
    }
    // all-or-nothing: the whole request must share one data owner (the owner
    // of the endpoint's registry)
    const dataOwners = new Set(grants.map((grant) => grant.dataOwner))
    if (dataOwners.size !== 1) {
      throw new BadRequestHttpError('all grants must have the same dataOwner')
    }
    const dataOwner = [...dataOwners][0]
    const sai = await this.sessionManager.getSession(dataOwner)

    // TODO: support recursive inheritance
    // Incoming payload embeds child grant data (one level). Assign IRIs and
    // build FinalGrantData for each parent and its inheriting children.
    const finalGrants: FinalGrantData[] = []
    for (const topGrant of grants) {
      const grantId = await sai.mintIdentifier(sai.registrySet.hasGrantRegistry.id)
      const inheritingGrants = await Promise.all(
        (topGrant.hasInheritingGrant ?? []).map((childData) =>
          this.buildInheritingGrant(sai, childData, grantId)
        )
      )
      finalGrants.push(
        {
          ...topGrant,
          type: topGrant.type ?? [LWS.AccessGrant],
          id: grantId,
          hasInheritingGrant: inheritingGrants.map((grant) => grant.id!),
        },
        ...inheritingGrants
      )
    }

    // all-or-nothing: validate every grant in the request before any is stored.
    // The whole request is validated against the data owner's registry plus
    // the request's own grants (the parent/child tree is not stored yet), using
    // the same chain predicate as revocation closure.
    await this.validateDelegable(finalGrants, credentials.agent.webId, sai)

    const temporal = new Temporal()
    await temporal.init()
    // TODO: we could use start but it could lead to race conditions
    await temporal.client.workflow.execute(storeGrant, {
      taskQueue: 'create-grants',
      args: [finalGrants],
      workflowId: crypto.randomUUID(),
    })
    // echo the finalised grants (not just their ids): the grantor stores them
    // as the issuer-side replica `checkEquivalence` reads
    // (docs/plans/check-equivalence.md §2.1)
    const doc = JSON.stringify(finalGrants)
    const representation = new BasicRepresentation(doc, operation.target, APPLICATION_JSON)
    return new OkResponseDescription(representation.metadata, representation.data)
  }

  /**
   * Parse the request body as JSON. The delegation endpoint dispatches on the
   * message `type` (AccessRequest → issuance, AccessRevocation → revocation).
   */
  private async parseMessage(operation: OperationHttpHandlerInput['operation']): Promise<unknown> {
    let message: unknown
    try {
      message = JSON.parse(await readableToString(operation.body.data))
    } catch (err) {
      throw new BadRequestHttpError(err.message)
    }
    return message
  }

  private async buildInheritingGrant(
    sai: Awaited<ReturnType<SessionManager['getSession']>>,
    childData: IncomingGrantData,
    inheritsFromGrant: string
  ): Promise<FinalGrantData> {
    return {
      type: childData.type ?? [LWS.AccessGrant],
      storage: childData.storage,
      access: childData.access,
      grantedBy: childData.grantedBy,
      dataOwner: childData.dataOwner,
      registeredShapeTree: childData.registeredShapeTree,
      hasDataRegistration: childData.hasDataRegistration,
      scopeOfGrant: childData.scopeOfGrant,
      hasDataInstance: childData.hasDataInstance,
      id: await sai.mintIdentifier(sai.registrySet.hasGrantRegistry.id),
      inheritsFromGrant,
    }
  }

  /**
   * Validate the whole request with the C1 chain predicate: every grant's
   * requester must be its `grantedBy`, and the grant must be valid in the
   * data owner's registry once the request's grants are added (so the
   * parent/child request validates as the post-issuance tree). Source grants
   * are not delegated through this endpoint — they are stored by the owner.
   */
  private async validateDelegable(
    grants: FinalGrantData[],
    requesterWebId: string,
    sai: Awaited<ReturnType<SessionManager['getSession']>>
  ): Promise<void> {
    for (const grant of grants) {
      if (requesterWebId !== grant.grantedBy) {
        // TODO: change to UnprocessableEntityHttpError
        throw new BadRequestHttpError('invalid grantedBy')
      }
      if (grant.grantedBy === grant.dataOwner) {
        // TODO: change to UnprocessableEntityHttpError
        throw new BadRequestHttpError('source grants are not delegated')
      }
    }

    const transport = localSparqlTransport(sai.sparqlEndpoint)
    const existing = await getRegistryGrants(transport, sai.registrySet.hasGrantRegistry.id)
    const byId = new Map<string, GrantData>()
    for (const grant of existing) byId.set(grant.id!, grant)
    for (const grant of grants) byId.set(grant.id!, grant)

    const validity = grantChainValidity([...byId.values()])
    for (const grant of grants) {
      if (validity.get(grant.id!) !== true) {
        // TODO: change to UnprocessableEntityHttpError
        throw new BadRequestHttpError('no grant available for delegation')
      }
    }
  }
}
