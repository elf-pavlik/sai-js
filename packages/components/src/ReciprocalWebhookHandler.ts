import {
  BasicRepresentation,
  OperationHttpHandler,
  ResponseDescription,
} from '@solid/community-server'
import type { CredentialsExtractor, OperationHttpHandlerInput } from '@solid/community-server'
import { getLoggerFor } from 'global-logger-factory'
import type { ReciprocalWebhookStore } from './ReciprocalWebhookStore.js'
import { Temporal } from './temporal/client.js'
import { updateDelegatedGrants } from './temporal/workflows/grants.js'

export class ReciprocalWebhookHandler extends OperationHttpHandler {
  protected readonly logger = getLoggerFor(this)
  public constructor(
    private readonly credentialsExtractor: CredentialsExtractor,
    private readonly reciprocalWebhookStore: ReciprocalWebhookStore
  ) {
    super()
  }
  public async handle({
    operation,
    request,
  }: OperationHttpHandlerInput): Promise<ResponseDescription> {
    // TODO: check if sender matches one from the channel
    //
    // const credentials = await this.credentialsExtractor.handleSafe(request)
    const channel = await this.reciprocalWebhookStore.findBySendTo(operation.target.path)
    const temporal = new Temporal()
    await temporal.init()
    await temporal.client.workflow.start(updateDelegatedGrants, {
      taskQueue: 'update-delegated-grants',
      args: [
        {
          webId: channel.webId,
          peerId: channel.peerId,
        },
      ],
      workflowId: crypto.randomUUID(),
    })
    return new ResponseDescription(200)
  }
}
