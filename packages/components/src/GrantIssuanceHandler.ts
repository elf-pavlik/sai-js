import {
  findDelegableGrant,
  localSparqlTransport,
} from '@janeirodigital/interop-authorization-agent'
import {
  AccessRequest,
  type AccessRequestMessage,
  AccessRevocation,
  type FinalGrantData,
  type IncomingGrantData,
} from '@janeirodigital/interop-data-model'
import { discoverAuthorizationAgent, iriForContained } from '@janeirodigital/interop-utils'
import { INTEROP } from '@janeirodigital/interop-utils'
import {
  APPLICATION_JSON,
  BadRequestHttpError,
  BasicRepresentation,
  ForbiddenHttpError,
  OkResponseDescription,
  OperationHttpHandler,
  readableToString,
} from '@solid/community-server'
import type {
  CredentialsExtractor,
  OperationHttpHandlerInput,
  ResponseDescription,
} from '@solid/community-server'
import { getLoggerFor } from 'global-logger-factory'
import { GrantRevocationHandler } from './GrantRevocationHandler.js'
import type { SessionManager } from './SessionManager'
import { Temporal } from './temporal/client.js'
import { storeGrant } from './temporal/workflows/grants.js'

export class GrantIssuanceHandler extends OperationHttpHandler {
  protected readonly logger = getLoggerFor(this)
  public constructor(
    private readonly credentialsExtractor: CredentialsExtractor,
    private readonly sessionManager: SessionManager,
    private readonly sparqlEndpoint: string
  ) {
    super()
  }
  public async handle({
    operation,
    request,
  }: OperationHttpHandlerInput): Promise<ResponseDescription> {
    const credentials = await this.credentialsExtractor.handleSafe(request)
    if (!credentials.agent?.webId || !credentials.client?.clientId) {
      throw new ForbiddenHttpError()
    }
    // TODO: check if WebID served by this authz agent

    const uasId = await discoverAuthorizationAgent(credentials.agent.webId, fetch)
    if (credentials.client.clientId !== uasId) {
      throw new ForbiddenHttpError()
    }

    // the delegation endpoint dispatches on the message `type`
    const message = await this.parseMessage(operation)
    if (AccessRevocation.isAccessRevocationMessage(message)) {
      return new GrantRevocationHandler(this.sparqlEndpoint, this.sessionManager).revoke(
        message,
        credentials,
        operation
      )
    }
    if (!AccessRequest.isAccessRequestMessage(message)) {
      throw new BadRequestHttpError('invalid delegation message')
    }
    return this.issue(message, credentials, operation)
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
      const grantId = iriForContained(sai.registrySet.hasGrantRegistry, sai.randomUUID)
      const inheritingGrants = (topGrant.hasInheritingGrant ?? []).map((childData) =>
        this.buildInheritingGrant(sai, childData, grantId)
      )
      finalGrants.push(
        {
          ...topGrant,
          type: topGrant.type ?? [INTEROP.DataGrant],
          id: grantId,
          hasInheritingGrant: inheritingGrants.map((grant) => grant.id!),
        },
        ...inheritingGrants
      )
    }

    // all-or-nothing: validate every grant in the request before any is stored
    for (const grant of finalGrants) {
      await this.validateDelegable(grant, credentials.agent.webId)
    }

    const temporal = new Temporal()
    await temporal.init()
    // TODO: we could use start but it could lead to race conditions
    await temporal.client.workflow.execute(storeGrant, {
      taskQueue: 'create-grants',
      args: [finalGrants],
      workflowId: crypto.randomUUID(),
    })
    const doc = JSON.stringify(finalGrants.map((grant) => grant.id))
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

  private buildInheritingGrant(
    sai: Awaited<ReturnType<SessionManager['getSession']>>,
    childData: IncomingGrantData,
    inheritsFromGrant: string
  ): FinalGrantData {
    return {
      type: childData.type ?? [INTEROP.DataGrant],
      grantee: childData.grantee,
      grantedBy: childData.grantedBy,
      dataOwner: childData.dataOwner,
      registeredShapeTree: childData.registeredShapeTree,
      hasDataRegistration: childData.hasDataRegistration,
      hasStorage: childData.hasStorage,
      scopeOfGrant: childData.scopeOfGrant,
      accessMode: childData.accessMode,
      creatorAccessMode: childData.creatorAccessMode,
      hasDataInstance: childData.hasDataInstance,
      delegationOfGrant: childData.delegationOfGrant,
      id: iriForContained(sai.registrySet.hasGrantRegistry, sai.randomUUID),
      inheritsFromGrant,
    }
  }

  /**
   * Validate that one grant can be delegated: the requester is its
   * `grantedBy`, and an upstream grant covering it exists in the data owner's
   * registry (the query lives in the AA's `sparql.ts`).
   */
  private async validateDelegable(grant: FinalGrantData, requesterWebId: string): Promise<void> {
    if (requesterWebId !== grant.grantedBy) {
      // TODO: change to UnprocessableEntityHttpError
      throw new BadRequestHttpError('invalid grantedBy')
    }
    if (!(await findDelegableGrant(localSparqlTransport(this.sparqlEndpoint), grant))) {
      // TODO: change to UnprocessableEntityHttpError
      throw new BadRequestHttpError('no grant available for delegation')
    }
  }
}
