import { QueryEngine } from '@comunica/query-sparql-rdfjs'
import { ApplicationFactory } from '@janeirodigital/interop-data-model'
import { discoverAuthorizationAgent, fetchWrapper } from '@janeirodigital/interop-utils'
import type { Quad } from '@rdfjs/types'
import { arrayifyStream } from '@solid/community-server'
import type {
  Credentials,
  PermissionMap,
  PermissionReport,
  PolicyEngine,
} from '@solidlab/policy-engine'
import { ACP, PERMISSIONS } from '@solidlab/policy-engine'
import { type IBindings, SparqlEndpointFetcher } from 'fetch-sparql-endpoint'
import { getLoggerFor } from 'global-logger-factory'
import { Store } from 'n3'
import type { SaiAuthorizationManager } from './SaiAuthorizationManager.js'
import { ACL, INTEROP } from './vocabularies.js'

enum TargetType {
  Registry = 'Registry',
  Registration = 'Registration',
  Resource = 'Resource',
}

export class SaiPermissionsEngine implements PolicyEngine {
  private readonly logger = getLoggerFor(this)
  private readonly queryEngine = new QueryEngine()

  constructor(
    protected readonly manager: SaiAuthorizationManager,
    private readonly sparqlEndpoint: string
  ) {}
  /**
   * Returns the granted and denied permissions for the given input.
   *
   * @param target - Identifier of the targeted resource.
   * @param credentials - Credentials identifying who or what is trying to access the target resource.
   * @param permissions - Optional list of permissions that are being requested.
   *                      As an optimization, the engine can look at just those that are requested.
   */
  async getPermissions(
    target: string,
    credentials: Credentials,
    permissions?: string[]
  ): Promise<PermissionMap> {
    // check if reqested by User Authorization Server
    let uasId: string | undefined
    if (credentials.agent && credentials.client) {
      try {
        uasId = await discoverAuthorizationAgent(credentials.agent, fetchWrapper(fetch))
      } catch (err) {
        this.logger.error(`UAS discovery failed for: ${credentials.agent}; ${err}`)
      }
    }
    const uas = uasId && uasId === credentials.client

    // TODO: does it need spread or just fix in typings
    const authorizationData = [...(await this.manager.getAuthorizationData(target))]
    const targetType = await this.determineTargetType(target)
    let modes: string[] = []
    switch (targetType) {
      case TargetType.Registry:
        // TODO: use extra data to check if it is an admin using their UAS
        break
      case TargetType.Registration:
        modes = await this.findRegistrationModes(authorizationData, target, credentials, uas)
        break
      case TargetType.Resource:
        // could happen read on all and write on selected
        {
          const resourceModes = await this.findResourceModes(
            authorizationData,
            target,
            credentials,
            uas
          )
          const registryModes = await this.findRegistrationModes(
            authorizationData,
            this.manager.getParent(target),
            credentials,
            uas
          )
          const inheritedModes = await this.findInheritedModes(
            authorizationData,
            target,
            credentials,
            uas
          )
          modes = [...new Set([...resourceModes, ...registryModes, ...inheritedModes])]
        }
        break
      default:
        throw new Error(`unexpected IRI: ${target}`)
    }
    return {
      [PERMISSIONS.Create]: modes.includes(ACL.Create),
      // TODO: figure out why it is requested on Create
      [PERMISSIONS.Append]: modes.includes(ACL.Create),
      [PERMISSIONS.Read]: modes.includes(ACL.Read),
      [PERMISSIONS.Modify]: modes.includes(ACL.Update),
      [PERMISSIONS.Delete]: modes.includes(ACL.Delete),
    }
  }

  /**
   * Returns the granted and denied permissions for the given input.
   * This also generates a report describing why permissions were granted or denied.
   *
   * @param target - Identifier of the targeted resource.
   * @param credentials - Credentials identifying who or what is trying to access the target resource.
   * @param permissions - Optional list of permissions that are being requested.
   *                      As an optimization, the engine can look at just those that are requested.
   */
  getPermissionsWithReport(
    target: string,
    credentials: Credentials,
    permissions?: string[]
  ): Promise<PermissionReport> {
    throw new Error('do not use')
  }

  async getAccessModes(data: Quad[], grantId: string): Promise<string[]> {
    const store = new Store([...data])
    const modesQuery = `
    SELECT * WHERE {
      <${grantId}>
        <${INTEROP.accessMode}> ?o .
    }
  `
    const modesBindingsStream = await this.queryEngine.queryBindings(modesQuery, {
      sources: [store],
    })
    const modesBindings = await modesBindingsStream.toArray()
    return modesBindings
      .map((b) => b.get('o')?.value)
      .filter((item): item is NonNullable<typeof item> => Boolean(item))
  }

  // Inherited is the same as AllFromRegistry here
  async findGrant(
    data: Quad[],
    id: string,
    credentials: Credentials,
    scope: string,
    uas: boolean
  ): Promise<string | undefined> {
    let registrationId = id
    const selected = scope === INTEROP.SelectedFromRegistry
    if (selected) {
      registrationId = this.manager.getParent(id)
    }
    let { agent, client } = credentials
    if (!agent || !client) {
      agent = ACP.PublicAgent
      client = ACP.PublicClient
    }
    const store = new Store([...data])
    const grantQuery = `
      SELECT * WHERE {
        ?s 
          ${
            uas
              ? `
              <${INTEROP.grantee}> <${agent}> ;
            `
              : `
              <${INTEROP.grantedBy}> <${agent}> ;
              <${INTEROP.grantee}> <${client}> ;
            `
          }
          <${INTEROP.hasDataRegistration}> <${registrationId}> ;
          ${selected ? `<${INTEROP.hasDataInstance}> <${id}> ;` : ''}
          <${INTEROP.scopeOfGrant}> <${scope}> .
      }
    `
    const grantBindingsStream = await this.queryEngine.queryBindings(grantQuery, {
      sources: [store],
    })
    const grantBindings = await grantBindingsStream.toArray()
    // TODO: handle multiple valid grants
    const grantId = grantBindings[0]?.get('s')?.value
    if (grantId) return grantId
    // if not found try without credentials
    if (credentials.agent && credentials.client) return this.findGrant(data, id, {}, scope, false)
  }
  async findRegistrationModes(
    data: Quad[],
    registrationId: string,
    credentials: Credentials,
    uas: boolean
  ): Promise<string[]> {
    const grantId = await this.findGrant(
      data,
      registrationId,
      credentials,
      INTEROP.AllFromRegistry,
      uas
    )
    if (!grantId) return []
    return this.getAccessModes(data, grantId)
  }

  async findResourceModes(
    data: Quad[],
    resourceId: string,
    credentials: Credentials,
    uas: boolean
  ): Promise<string[]> {
    const grantId = await this.findGrant(
      data,
      resourceId,
      credentials,
      INTEROP.SelectedFromRegistry,
      uas
    )
    if (!grantId) return []
    return this.getAccessModes(data, grantId)
  }

  async findInheritedModes(
    data: Quad[],
    resourceId: string,
    credentials: Credentials,
    uas: boolean
  ): Promise<string[]> {
    const registrationId = this.manager.getParent(resourceId)
    const grantId = await this.findGrant(data, registrationId, credentials, INTEROP.Inherited, uas)
    if (!grantId) return []
    const parentGrantId = await this.findObject(data, grantId, INTEROP.inheritsFromGrant)
    if (!parentGrantId) throw new Error(`parent not found for Inherited grant: ${grantId}`)
    // TODO: consider multi parent, and parents of different types
    const parentResourceId = await this.findParentResource(data, grantId, parentGrantId, resourceId)
    if (!parentResourceId) return []
    const parentResourcePermissions = await this.getPermissions(parentResourceId, credentials)
    if (parentResourcePermissions[PERMISSIONS.Read]) {
      return this.getAccessModes(data, grantId)
    }
    return []
  }

  async findObject(data: Quad[], subject: string, predicate: string): Promise<string | undefined> {
    const query = `
      SELECT * WHERE {
        <${subject}>
          <${predicate}> ?o .
      }
    `
    const store = new Store([...data])
    const bindingsStream = await this.queryEngine.queryBindings(query, {
      sources: [store],
    })
    const bindings = await bindingsStream.toArray()
    return bindings[0].get('o')?.value
  }

  async findParentResource(
    data: Quad[],
    childGrantId: string,
    parentGrantId: string,
    resourceId: string
  ): Promise<string> {
    // find predicate
    const parentShapeTreeId = await this.findObject(
      data,
      parentGrantId,
      INTEROP.registeredShapeTree
    )
    if (!parentShapeTreeId) throw new Error(`invalid grant, missing shapeTree: ${parentGrantId}`)
    const childShapeTreeId = await this.findObject(data, childGrantId, INTEROP.registeredShapeTree)
    if (!childShapeTreeId) throw new Error(`invalid grant, missing shapeTree: ${childGrantId}`)
    const factory = new ApplicationFactory({
      fetch: fetchWrapper(fetch),
      randomUUID: crypto.randomUUID,
    })
    const shapeTree = await factory.readable.shapeTree(parentShapeTreeId)
    const shapeTreeReference = shapeTree.references.find(
      (stRef) => stRef.shapeTree === childShapeTreeId
    )
    const predicate = shapeTreeReference.viaPredicate.value
    const fetcher = new SparqlEndpointFetcher()
    const bindingsStream = await fetcher.fetchBindings(
      this.sparqlEndpoint,
      `
          SELECT * WHERE {
            GRAPH ?g {?s <${predicate}> <${resourceId}> }
          }
        `
    )
    const results = await arrayifyStream<IBindings>(bindingsStream)
    // TODO: ensure only in proper registration
    // biome-ignore lint/complexity/useLiteralKeys:
    const parentId = results[0]?.['s'].value
    if (!parentId) return
    // check if in parent registration
    const parentRegistrationId = await this.findObject(
      data,
      parentGrantId,
      INTEROP.hasDataRegistration
    )
    // TODO: not needed if query only in proper registration
    if (this.manager.getParent(parentId) !== parentRegistrationId)
      throw new Error(`something fishy - ${parentId} not in ${parentRegistrationId}`)
    return parentId
  }

  async determineTargetType(id: string): Promise<TargetType | undefined> {
    const storage = await this.manager.getStorage(id)
    if (id === storage) {
      return TargetType.Registry
    }
    const parent = this.manager.getParent(id)
    if (parent === storage) {
      return TargetType.Registration
    }
    const grandParent = this.manager.getParent(parent)
    if (grandParent === storage) {
      return TargetType.Resource
    }
  }
}
