import { ActivityRegistry } from '@janeirodigital/interop-data-model'
import { INTEROP } from '@janeirodigital/interop-utils'
import {
  BadRequestHttpError,
  NotFoundHttpError,
  OperationHttpHandler,
  ResponseDescription,
  readableToString,
} from '@solid/community-server'
import type { CredentialsExtractor, OperationHttpHandlerInput } from '@solid/community-server'
import { getLoggerFor } from 'global-logger-factory'
import type { ReciprocalWebhookStore } from './ReciprocalWebhookStore.js'
import type { SessionManager } from './SessionManager'

export class ReciprocalWebhookHandler extends OperationHttpHandler {
  protected readonly logger = getLoggerFor(this)
  public constructor(
    private readonly credentialsExtractor: CredentialsExtractor,
    private readonly reciprocalWebhookStore: ReciprocalWebhookStore,
    private readonly sessionManager: SessionManager
  ) {
    super()
  }
  public async handle({ operation }: OperationHttpHandlerInput): Promise<ResponseDescription> {
    const channel = await this.reciprocalWebhookStore.findBySendTo(operation.target.path)
    if (!channel) {
      // TODO: unsubscribe
      throw new NotFoundHttpError()
    }

    // TODO: check if sender matches one from the channel
    //
    // const credentials = await this.credentialsExtractor.handleSafe(request)

    // only write an activity on Update — the container Add then routes through
    // the same ActivityWebhookHandler path as every other producer (uniform
    // outbox: the UI gets a `done` event for peer-driven updates too)
    let requestBody: { type: string }
    try {
      requestBody = JSON.parse(await readableToString(operation.body.data))
    } catch (err) {
      throw new BadRequestHttpError(err.message)
    }
    if (requestBody.type === 'Update') {
      const session = await this.sessionManager.getSession(channel.webId)
      const activityRegistry = session.registrySet.hasActivityRegistry
      if (!activityRegistry) throw new Error('activity registry not found in registry set')
      await ActivityRegistry.createActivity(activityRegistry, session.factory, {
        activityType: 'delegatedGrantsUpdated',
        // the peer — the side whose reciprocal-registration Update triggered
        // this webhook; informational only, not consumed by any workflow
        target: channel.peerId,
        payload: {
          webId: { id: channel.webId, type: [INTEROP.SocialAgent] },
          peerId: { id: channel.peerId, type: [INTEROP.SocialAgent] },
        },
        createdAt: new Date().toISOString(),
      })
    }
    return new ResponseDescription(200)
  }
}