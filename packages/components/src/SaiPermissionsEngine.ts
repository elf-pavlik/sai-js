import { QueryEngine } from '@comunica/query-sparql-rdfjs'
import { discoverAuthorizationAgent, fetchWrapper } from '@janeirodigital/interop-utils'
import type { Quad } from '@rdfjs/types'
import type {
  Credentials,
  PermissionMap,
  PermissionReport,
  PolicyEngine,
} from '@solidlab/policy-engine'
import { ACP, PERMISSIONS } from '@solidlab/policy-engine'
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

  constructor(protected readonly manager: SaiAuthorizationManager) {}
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
    // TODO: move it into findGrant
    if (!credentials.agent || !credentials.client) {
      credentials.agent = ACP.PublicAgent
      credentials.client = ACP.PublicClient
    }

    // TODO: does it need spread or just fix in typings
    const authorizationData = [...(await this.manager.getAuthorizationData(target))]
    const targetType = await this.determineTargetType(target)
    let modes: string[] = []
    switch (targetType) {
      case TargetType.Registry:
        // TODO: use extra data to check if it is an admin using their UAS
        break
      case TargetType.Registration:
        modes = await this.findRegistryModes(
          authorizationData,
          target,
          credentials.agent,
          credentials.client
        )
        break
      case TargetType.Resource:
        // TODO: do we need to check both options?
        {
          const resourceModes = await this.findResourceModes(
            authorizationData,
            target,
            credentials.agent,
            credentials.client
          )
          const registryModes = await this.findRegistryModes(
            authorizationData,
            this.manager.getParent(target),
            credentials.agent,
            credentials.client
          )
          modes = [...new Set([...resourceModes, ...registryModes])]
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

  async findGrant(
    data: Quad[],
    id: string,
    agent: string,
    client: string,
    scope: string
  ): Promise<string | undefined> {
    let registrationId = id
    const selected = scope === INTEROP.SelectedFromRegistry
    if (selected) {
      registrationId = this.manager.getParent(id)
    }
    // check if reqested by User Authorization Server
    let uasId: string | undefined
    try {
      uasId = await discoverAuthorizationAgent(agent, fetchWrapper(fetch))
    } catch (err) {
      this.logger.error(`UAS discovery failed for: ${agent}; ${err}`)
    }
    const uas = uasId === client
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
    return grantBindings[0]?.get('s')?.value
  }
  async findRegistryModes(
    data: Quad[],
    registrationId: string,
    agent: string,
    client: string
  ): Promise<string[]> {
    let grantId = await this.findGrant(data, registrationId, agent, client, INTEROP.AllFromRegistry)
    if (!grantId) {
      grantId = await this.findGrant(
        data,
        registrationId,
        ACP.PublicAgent,
        ACP.PublicClient,
        INTEROP.AllFromRegistry
      )
    }
    if (!grantId) return []
    return this.getAccessModes(data, grantId)
  }

  async findResourceModes(
    data: Quad[],
    resourceId: string,
    agent: string,
    client: string
  ): Promise<string[]> {
    let grantId = await this.findGrant(
      data,
      resourceId,
      agent,
      client,
      INTEROP.SelectedFromRegistry
    )
    if (!grantId) {
      grantId = await this.findGrant(
        data,
        resourceId,
        ACP.PublicAgent,
        ACP.PublicClient,
        INTEROP.SelectedFromRegistry
      )
    }
    if (!grantId) return []
    return this.getAccessModes(data, grantId)
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
