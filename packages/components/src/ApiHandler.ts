import {
  BasicRepresentation,
  ForbiddenHttpError,
  InternalServerError,
  OkResponseDescription,
  OperationHttpHandler,
  SOLID_HTTP,
} from '@solid/community-server'
import type { CookieStore, WebIdStore } from '@solid/community-server'
import type { OperationHttpHandlerInput, ResponseDescription } from '@solid/community-server'

export class ApiHandler extends OperationHttpHandler {
  constructor(
    private readonly cookieStore: CookieStore,
    private readonly webIdStore: WebIdStore
  ) {
    super()
  }
  public async handle({ operation }: OperationHttpHandlerInput): Promise<ResponseDescription> {
    // Determine account
    const cookie = operation.body.metadata.get(SOLID_HTTP.terms.accountCookie)?.value
    if (!cookie) {
      throw new ForbiddenHttpError()
    }
    const accountId = await this.cookieStore.get(cookie)
    if (!accountId) {
      // TODO: find better error
      throw new InternalServerError()
    }
    const webIdLinks = await this.webIdStore.findLinks(accountId)
    const doc = JSON.stringify({ accountId, webIdLinks })
    const representation = new BasicRepresentation(doc, operation.target, 'application/json')
    return new OkResponseDescription(representation.metadata, representation.data)
  }
}
