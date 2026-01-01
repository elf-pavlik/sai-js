import type {
  MultiPermissionMap,
  PermissionReaderInput,
  PodStore,
  StorageLocationStrategy,
} from '@solid/community-server'
import {
  IdentifierMap,
  IdentifierSetMultiMap,
  PermissionReader,
  filter,
  getDefault,
} from '@solid/community-server'
import type { PermissionMap } from '@solidlab/policy-engine'
import { PERMISSIONS } from '@solidlab/policy-engine'
import { getLoggerFor } from 'global-logger-factory'

const allPermissions = {
  [PERMISSIONS.Create]: true,
  [PERMISSIONS.Read]: true,
  [PERMISSIONS.Modify]: true,
  [PERMISSIONS.Delete]: true,
}
export class AdminPermissionReader extends PermissionReader {
  protected readonly logger = getLoggerFor(this)

  public constructor(
    protected readonly podStore: PodStore,
    protected readonly storageStrategy: StorageLocationStrategy,
    protected readonly reader: PermissionReader
  ) {
    super()
  }

  public async canHandle(input: PermissionReaderInput): Promise<void> {
    return this.reader.canHandle(input)
  }

  public async handle(input: PermissionReaderInput): Promise<MultiPermissionMap> {
    if (input.requestedModes.size !== 1) {
      this.logger.info([...input.requestedModes].map(([id, mode]) => id.path).join(', '))
      throw new Error('☝ requested permissions for multiple resources')
    }
    const requestedResource = [...input.requestedModes.distinctKeys()][0]
    let result: MultiPermissionMap
    if (this.requestFromAdmin(input)) {
      result = new IdentifierMap([[requestedResource, allPermissions]])
    } else {
      result = await this.reader.handle({
        requestedModes: input.requestedModes,
        credentials: input.credentials,
      })
    }
    return result
  }
  private async requestFromAdmin(input: PermissionReaderInput): Promise<boolean> {
    if (!input.credentials.agent) return false
    const requestedResource = [...input.requestedModes.distinctKeys()][0]
    const storageId = await this.storageStrategy.getStorageIdentifier(requestedResource)
    const storage = await this.podStore.findByBaseUrl(storageId.path)
    const owners = await this.podStore.getOwners(storage.id)
    return owners.some((owner) => owner.webId === input.credentials.agent.webId)
  }
}
