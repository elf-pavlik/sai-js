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
  arrayifyStream,
} from '@solid/community-server'
import type {
  CredentialsExtractor,
  OperationHttpHandlerInput,
  ResponseDescription,
} from '@solid/community-server'
import { type IBindings, SparqlEndpointFetcher } from 'fetch-sparql-endpoint'
import { Temporal } from './temporal/client.js'
import { revokeGrants } from './temporal/workflows/grants.js'
import { INTEROP } from './vocabularies.js'

type Credentials = Awaited<ReturnType<CredentialsExtractor['handleSafe']>>

/** Authority-relevant fields of a grant removed by a revocation. */
export interface RevokedGrant {
  iri: string
  dataOwner: string
  grantedBy: string
  grantee: string
}

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
 * The same `revokeGrants` core is reused by the delegation endpoint and the
 * data-owner UI RPC; the HTTP `revoke` is a thin wrapper around it.
 */
export class GrantRevocationHandler {
  public constructor(private readonly sparqlEndpoint: string) {}

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
   * Shared core (delegation endpoint + data-owner UI RPC): validate every
   * listed grant before any deletion, then delete the listed grants plus their
   * inheriting children (fixpoint `?child interop:inheritsFromGrant ?parent`)
   * with the data owner's own session. Idempotent: already-removed grants are
   * skipped and echoed by the caller. Returns the removed closure with
   * authority-relevant fields so callers can derive follow-ups (e.g. clearing
   * the grantor's registration projection).
   */
  public async revokeGrants(
    grants: string[],
    requesterWebId: string | undefined
  ): Promise<RevokedGrant[]> {
    if (grants.length === 0) {
      throw new BadRequestHttpError('AccessRevocation requires at least one grant')
    }

    // load every listed grant from the data owner's registry (SPARQL);
    // missing grants count as already-removed (idempotent no-op)
    const fetcher = new SparqlEndpointFetcher()
    const loaded = await this.findGrants(fetcher, grants)

    // all-or-nothing: all existing grants must share one data owner (the
    // owner of the endpoint's registry)
    const dataOwners = new Set([...loaded.values()].map((grant) => grant.dataOwner))
    if (dataOwners.size > 1) {
      throw new BadRequestHttpError('all grants must have the same dataOwner')
    }

    // authority per grant, before any deletion: grantor (grantedBy) or owner
    for (const grant of loaded.values()) {
      const isGrantor = requesterWebId === grant.grantedBy
      const isDataOwner = requesterWebId === grant.dataOwner
      if (!isGrantor && !isDataOwner) {
        throw new ForbiddenHttpError()
      }
    }

    // dependent closure: the listed grants plus their inheriting children
    // (fixpoint over inheritsFromGrant — one level today, recursive-ready)
    const closure = new Map<string, RevokedGrant>()
    for (const [iri, grant] of loaded) closure.set(iri, { iri, ...grant })
    while (true) {
      const children = await this.findInheritingChildren(fetcher, [...closure.keys()])
      const fresh = children.filter((child) => !closure.has(child))
      if (fresh.length === 0) break
      for (const [iri, grant] of await this.findGrants(fetcher, fresh)) {
        closure.set(iri, { iri, ...grant })
      }
    }

    // delete through Temporal, mirroring issuance: the worker runs the deletes
    // with the data owner's own session (owner rights), with activity-retry
    // semantics; the response only returns once the closure is gone
    if (closure.size > 0) {
      const dataOwner: SocialAgentId = {
        id: [...loaded.values()][0].dataOwner,
        type: [INTEROP.SocialAgent],
      }
      const toDelete: GrantId[] = [...closure.keys()].map((id) => ({
        id,
        type: [INTEROP.DataGrant],
      }))
      const temporal = new Temporal()
      await temporal.init()
      await temporal.client.workflow.execute(revokeGrants, {
        taskQueue: 'create-grants',
        workflowId: crypto.randomUUID(),
        args: [{ webId: dataOwner, grants: toDelete }],
      })
    }

    return [...closure.values()]
  }

  /**
   * Load the authority-relevant fields of the given grants from the data
   * owner's registry. Grants that do not exist (already removed) are absent.
   */
  private async findGrants(
    fetcher: SparqlEndpointFetcher,
    iris: string[]
  ): Promise<Map<string, Omit<RevokedGrant, 'iri'>>> {
    if (iris.length === 0) return new Map()
    const values = iris.map((iri) => `<${iri}>`).join(' ')
    const query = `
  SELECT ?grant ?dataOwner ?grantedBy ?grantee WHERE {
    GRAPH ?g {
      ?grant
        <${INTEROP.dataOwner}> ?dataOwner;
        <${INTEROP.grantedBy}> ?grantedBy;
        <${INTEROP.grantee}> ?grantee .
    }
    VALUES ?grant { ${values} }
  }
  `
    const bindingsStream = await fetcher.fetchBindings(this.sparqlEndpoint, query)
    const bindings = await arrayifyStream<IBindings>(bindingsStream)
    const result = new Map<string, Omit<RevokedGrant, 'iri'>>()
    for (const binding of bindings) {
      result.set(binding.grant.value, {
        dataOwner: binding.dataOwner.value,
        grantedBy: binding.grantedBy.value,
        grantee: binding.grantee.value,
      })
    }
    return result
  }

  /**
   * All grants in the registry whose `inheritsFromGrant` points at any of the
   * given parents.
   */
  private async findInheritingChildren(
    fetcher: SparqlEndpointFetcher,
    parents: string[]
  ): Promise<string[]> {
    if (parents.length === 0) return []
    const values = parents.map((iri) => `<${iri}>`).join(' ')
    const query = `
  SELECT ?child WHERE {
    GRAPH ?g {
      ?child <${INTEROP.inheritsFromGrant}> ?parent .
    }
    VALUES ?parent { ${values} }
  }
  `
    const bindingsStream = await fetcher.fetchBindings(this.sparqlEndpoint, query)
    const bindings = await arrayifyStream<IBindings>(bindingsStream)
    return bindings.map((binding) => binding.child.value)
  }
}
