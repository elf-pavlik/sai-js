import { ActivityRegistry } from '@janeirodigital/interop-data-model'
import {
  BadRequestHttpError,
  NotFoundHttpError,
  OperationHttpHandler,
  ResponseDescription,
  readableToString,
} from '@solid/community-server'
import type { OperationHttpHandlerInput } from '@solid/community-server'
import { getLoggerFor } from 'global-logger-factory'
import type { Workflow } from '@temporalio/common'
import type { ActivityWebhookStore } from './ActivityWebhookStore.js'
import type { SessionManager } from './SessionManager'
import { Temporal } from './temporal/client.js'
import type { ReciprocalRegistrationInput } from './temporal/activities/reciprocal.js'
import {
  createGrantsForAuthorization,
  processRoleDeletion,
  processRoleMembershipChange,
} from './temporal/workflows/grants.js'
import { establishReciprocal } from './temporal/workflows/reciprocal.js'

// activityType → workflow + task queue (the single handler stays dumb; producers
// write the typed change and the payload is the ready-made workflow input)
const activityWorkflows: Record<string, { workflow: Workflow; taskQueue: string }> = {
  roleMembershipChanged: { workflow: processRoleMembershipChange, taskQueue: 'create-grants' },
  roleDeleted: { workflow: processRoleDeletion, taskQueue: 'create-grants' },
  authorizationRecorded: { workflow: createGrantsForAuthorization, taskQueue: 'create-grants' },
  agentRegistrationAdded: {
    workflow: establishReciprocal,
    taskQueue: 'reciprocal-registration',
  },
}

/**
 * Receives webhook notifications from the org's Activity Registry container
 * subscription. On `Add` (an activity resource was PUT), fetches the activity,
 * maps `activityType` → workflow and starts it with the activity's payload.
 */
export class ActivityWebhookHandler extends OperationHttpHandler {
  protected readonly logger = getLoggerFor(this)
  public constructor(
    private readonly activityWebhookStore: ActivityWebhookStore,
    private readonly sessionManager: SessionManager
  ) {
    super()
  }
  public async handle({ operation }: OperationHttpHandlerInput): Promise<ResponseDescription> {
    const channel = await this.activityWebhookStore.findBySendTo(operation.target.path)
    if (!channel) {
      // TODO: unsubscribe
      throw new NotFoundHttpError()
    }

    // TODO: check if sender matches one from the channel
    let requestBody: { type: string; object?: string }
    try {
      requestBody = JSON.parse(await readableToString(operation.body.data))
    } catch (err) {
      throw new BadRequestHttpError(err.message)
    }

    if (requestBody.type === 'Add' && requestBody.object) {
      const session = await this.sessionManager.getSession(channel.webId)
      const activity = await ActivityRegistry.loadActivity(requestBody.object, session.factory)

      const entry = activityWorkflows[activity.activityType]
      if (entry) {
        const temporal = new Temporal()
        await temporal.init()
        // agentRegistrationAdded needs the accountId (the channel is per-account)
        const args =
          activity.activityType === 'agentRegistrationAdded'
            ? [{ accountId: channel.accountId, ...(activity.payload as object) }]
            : [activity.payload]
        await temporal.client.workflow.start(entry.workflow, {
          taskQueue: entry.taskQueue,
          args: args as [ReciprocalRegistrationInput],
          workflowId: crypto.randomUUID(),
        })
      }
    }
    return new ResponseDescription(200)
  }
}
