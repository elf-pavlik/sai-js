import {
  AccessRequest,
  type AccessRequestMessage,
  type FinalGrantData,
  GrantRegistry,
  type IncomingGrantData,
} from '@janeirodigital/interop-data-model'
import { discoverAuthorizationAgent } from '@janeirodigital/interop-utils'
import {
  APPLICATION_JSON,
  BadRequestHttpError,
  BasicRepresentation,
  ForbiddenHttpError,
  OkResponseDescription,
  OperationHttpHandler,
  arrayifyStream,
  readableToString,
} from '@solid/community-server'
import type {
  CredentialsExtractor,
  OperationHttpHandlerInput,
  ResponseDescription,
} from '@solid/community-server'
import { type IBindings, SparqlEndpointFetcher } from 'fetch-sparql-endpoint'
import { getLoggerFor } from 'global-logger-factory'
import type { SessionManager } from './SessionManager'
import { Temporal } from './temporal/client.js'
import { storeGrant } from './temporal/workflows/grants.js'
import { INTEROP } from './vocabularies.js'

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

    const message = await this.parseMessage(operation)
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
      const grantId = GrantRegistry.iriForContained(sai.registrySet.hasGrantRegistry, sai.factory)
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
    const fetcher = new SparqlEndpointFetcher()
    for (const grant of finalGrants) {
      await this.validateDelegable(grant, credentials.agent.webId, fetcher)
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
   * Parse the request body as an `interop:AccessRequest` envelope. Any other
   * message type is rejected (the delegation endpoint dispatches on `type`).
   */
  private async parseMessage(
    operation: OperationHttpHandlerInput['operation']
  ): Promise<AccessRequestMessage> {
    let message: unknown
    try {
      message = JSON.parse(await readableToString(operation.body.data))
    } catch (err) {
      throw new BadRequestHttpError(err.message)
    }
    if (AccessRequest.isAccessRequestMessage(message)) {
      return message
    }
    throw new BadRequestHttpError('invalid AccessRequest message')
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
      id: GrantRegistry.iriForContained(sai.registrySet.hasGrantRegistry, sai.factory),
      inheritsFromGrant,
    }
  }

  /**
   * Validate that one grant can be delegated: the requester is its
   * `grantedBy`, and an upstream grant covering it exists in the data owner's
   * registry.
   */
  private async validateDelegable(
    grant: FinalGrantData,
    requesterWebId: string,
    fetcher: SparqlEndpointFetcher
  ): Promise<void> {
    if (requesterWebId !== grant.grantedBy) {
      // TODO: change to UnprocessableEntityHttpError
      throw new BadRequestHttpError('invalid grantedBy')
    }
    // find grant that can be delegated
    // TODO: handle multiple grants for the same registration, especially with inheritance
    const accessModes = grant.accessMode.map((m) => `<${m}>`).join(' ')

    const requiredInstances = grant.hasDataInstance?.length
      ? grant.hasDataInstance.map((i) => `<${i}>`).join(' ')
      : ''

    const selectedScopeConstraint = requiredInstances
      ? `
          FILTER NOT EXISTS {
            VALUES ?required { ${requiredInstances} }
            FILTER NOT EXISTS {
              ?s <${INTEROP.hasDataInstance}> ?required .
            }
          }
      `
      : ''

    const scopeBlock =
      grant.scopeOfGrant === INTEROP.SelectedFromRegistry
        ? `
        {
          ?s <${INTEROP.scopeOfGrant}> <${INTEROP.AllFromRegistry}> .
        }
        UNION
        {
          ?s <${INTEROP.scopeOfGrant}> <${INTEROP.SelectedFromRegistry}> .
          ${selectedScopeConstraint}
        }
      `
        : `
        ?s <${INTEROP.scopeOfGrant}> <${grant.scopeOfGrant}> .
      `

    const query = `
  SELECT * WHERE {
    GRAPH ?g {
      ?s
        <${INTEROP.dataOwner}> <${grant.dataOwner}>;
        <${INTEROP.grantee}> <${grant.grantedBy}>;
        <${INTEROP.registeredShapeTree}> <${grant.registeredShapeTree}>;
        <${INTEROP.hasStorage}> <${grant.hasStorage}>;
        <${INTEROP.hasDataRegistration}> <${grant.hasDataRegistration}>;
        <${INTEROP.accessMode}> ?mode .

      VALUES ?mode { ${accessModes} }

      ${scopeBlock}
    }
  }
  `
    const bindingsStream = await fetcher.fetchBindings(this.sparqlEndpoint, query)
    const queryResults = await arrayifyStream<IBindings>(bindingsStream)
    if (!queryResults.length) {
      // TODO: change to UnprocessableEntityHttpError
      throw new BadRequestHttpError('no grant available for delegation')
    }
  }
}
