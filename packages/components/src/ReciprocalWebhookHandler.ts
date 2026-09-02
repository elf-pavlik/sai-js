import { ActivityRegistry } from '@janeirodigital/interop-authorization-agent'
import type { DelegatedGrantsUpdated } from '@janeirodigital/interop-data-model'
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
      // mirror maintenance is NOT done here — this handler only records the
      // `delegatedGrantsUpdated` activity (the outbox pattern); the mirror
      // sync runs as a Temporal workflow started by ActivityWebhookHandler
      const session = await this.sessionManager.getSession(channel.webId)
      const activityRegistry = session.registrySet.hasActivityRegistry
      if (!activityRegistry) throw new Error('activity registry not found in registry set')
      // the reciprocal registration (the peer's reciprocal — informational;
      // `target` is the peer). Tolerantly read: the registration may not
      // exist yet on the first peer update.
      let reciprocalRegistration = ''
      try {
        const registration = await session.findSocialAgentRegistration(channel.peerId)
        reciprocalRegistration = registration?.reciprocalRegistration ?? ''
      } catch {
        // informational only — never fail the webhook
      }
      const activity: Omit<DelegatedGrantsUpdated, 'id'> = {
        type: ['Activity', 'DelegatedGrantsUpdated'],
        actor: channel.webId,
        // the peer — the side whose reciprocal-registration Update triggered
        // this webhook; informational only, not consumed by any workflow
        target: channel.peerId,
        object: reciprocalRegistration,
        createdAt: new Date().toISOString(),
      }
      await ActivityRegistry.createActivity(
        activityRegistry,
        { fetch: session.fetch, randomUUID: session.randomUUID },
        activity
      )
    }
    return new ResponseDescription(200)
  }
}
