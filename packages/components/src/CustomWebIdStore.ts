import { BaseWebIdStore, WEBID_STORAGE_TYPE } from '@solid/community-server'

export class CustomWebIdStore extends BaseWebIdStore {
  public async findAccout(webId: string): Promise<string> {
    //@ts-ignore
    const result = await this.storage.find(WEBID_STORAGE_TYPE, { webId })
    return result[0]?.accountId
  }
}
