import {
  type RevokedGrant,
  getGrantsAuthority,
  localSparqlTransport,
} from '@janeirodigital/interop-authorization-agent'
import type { AuthorizationAgent } from '@janeirodigital/interop-authorization-agent'
import type {
  AccessRevocationMessage,
  GrantId,
  SocialAgentId,
} from '@janeirodigital/interop-data-model'
import {
  APPLICATION_JSON,
  BadRequestHttpError,
  BasicRepresentation,
  ForbiddenHttpError,
  OkResponseDescription,
} from '@solid/community-server'
import type {
  CredentialsExtractor,
  OperationHttpHandlerInput,
  ResponseDescription,
} from '@solid/community-server'

/** The revocation handler needs only session acquisition (the owner session). */
export interface SessionAcquirer {
  getSession(webId: string): Promise<AuthorizationAgent>
}
import { Temporal } from './temporal/client.js'
import { revokeGrants } from './temporal/workflows/grants.js'
import { INTEROP } from '@janeirodigital/interop-utils'

type Credentials = Awaited<ReturnType<CredentialsExtractor['handleSafe']>>

/**
 * Revocation of delegated grants at the data-owner boundary.
 *
 * Mirrors issuance on the same delegation endpoint (dispatched on message
 * `type`). All-or-nothing: the whole request is validated (every listed grant
 * is SPARQL-loaded and authority-checked) before anything is deleted. Deletion
 * of the listed grants plus their inheriting children runs with the data
 * owner's own session (owner rights — no ACR/403 problem). Revoking an
 * already-removed grant is a no-op: the response echoes the request's grant
 * IRIs. Authorization: the requester must be the UA of each grant's
 * `grantedBy` (grantor branch) or the data owner itself (owner branch).
 *
 * The validation + closure core is the AA session method `revokeGrants`; this
 * handler keeps the HTTP envelope, the Temporal deletion glue, and the
 * HTTP-error mapping.
 */
export class GrantRevocationHandler {
  public constructor(
    private readonly sparqlEndpoint: string,
    private readonly sessionManager: SessionAcquirer
  ) {}

  public async revoke(
    message: AccessRevocationMessage,
    credentials: Credentials,
    operation: OperationHttpHandlerInput['operation']
  ): Promise<ResponseDescription> {
    const { grants } = message
    await this.revokeGrants(grants, credentials.agent?.webId)

    // response = removed list; under all-or-nothing that equals the request's
    // `grants` (already-removed entries are echoed too — idempotent no-op)
    const doc = JSON.stringify(grants)
    const representation = new BasicRepresentation(doc, operation.target, APPLICATION_JSON)
    return new OkResponseDescription(representation.metadata, representation.data)
  }

  /**
   * Shared core (delegation endpoint + data-owner UI RPC): discover the data
   * owner, then delegate validation + closure to the owner session's
   * `revokeGrants`, then delete the closure through Temporal with that session.
   * Idempotent: already-removed grants are skipped and echoed by the caller.
   */
  public async revokeGrants(
    grants: string[],
    requesterWebId: string | undefined
  ): Promise<RevokedGrant[]> {
    if (grants.length === 0) {
      throw new BadRequestHttpError('AccessRevocation requires at least one grant')
    }

    const transport = localSparqlTransport(this.sparqlEndpoint)
    const loaded = await getGrantsAuthority(transport, grants)

    // all-or-nothing: all existing grants must share one data owner (the
    // owner of the endpoint's registry)
    const dataOwners = new Set([...loaded.values()].map((grant) => grant.dataOwner))
    if (dataOwners.size > 1) {
      throw new BadRequestHttpError('all grants must have the same dataOwner')
    }

    // nothing loaded → all already removed → idempotent no-op
    if (loaded.size === 0) return []

    const dataOwner = [...loaded.values()][0].dataOwner
    const session = await this.sessionManager.getSession(dataOwner)

    // the session core validates authority + computes the inheriting-children
    // closure (fixpoint over inheritsFromGrant)
    let revoked: RevokedGrant[]
    try {
      revoked = await session.revokeGrants(grants, requesterWebId)
    } catch (err) {
      if (err instanceof Error && err.message.includes('dataOwner')) {
        throw new BadRequestHttpError(err.message)
      }
      if (err instanceof Error && err.message.includes('grantor')) {
        throw new ForbiddenHttpError()
      }
      throw err
    }

    // delete through Temporal, mirroring issuance: the worker runs the deletes
    // with the data owner's own session (owner rights), with activity-retry
    // semantics; the response only returns once the closure is gone
    if (revoked.length > 0) {
      const owner: SocialAgentId = {
        id: dataOwner,
        type: [INTEROP.SocialAgent],
      }
      const toDelete: GrantId[] = revoked.map((grant) => ({
        id: grant.iri,
        type: [INTEROP.DataGrant],
      }))
      const temporal = new Temporal()
      await temporal.init()
      await temporal.client.workflow.execute(revokeGrants, {
        taskQueue: 'create-grants',
        workflowId: crypto.randomUUID(),
        args: [{ webId: owner, grants: toDelete }],
      })
    }

    return revoked
  }
}
