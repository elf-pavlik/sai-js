import { ActivityRegistry } from '@janeirodigital/interop-data-model'
import { INTEROP } from '@janeirodigital/interop-utils'
import {
  BadRequestHttpError,
  NotFoundHttpError,
  OperationHttpHandler,
  ResponseDescription,
  readableToString,
} from '@solid/community-server'
import type { OperationHttpHandlerInput } from '@solid/community-server'
import { WorkflowExecutionAlreadyStartedError } from '@temporalio/client'
import { getLoggerFor } from 'global-logger-factory'
import type { Workflow } from '@temporalio/common'
import type { ActivityWebhookStore } from './ActivityWebhookStore.js'
import type { SessionManager } from './SessionManager'
import { Temporal } from './temporal/client.js'
import type { CreateGrantsInput } from './temporal/activities/grants.js'
import type { ReciprocalRegistrationInput } from './temporal/activities/reciprocal.js'
import {
  granteeActivitiesSignal,
  processGranteeActivities,
  processRoleDeletion,
  processRoleMembershipChange,
} from './temporal/workflows/grants.js'
import { establishReciprocal } from './temporal/workflows/reciprocal.js'

// activityType → workflow + task queue (the single handler stays dumb; producers
// write the typed change and the payload is the ready-made workflow input).
// authorizationRecorded/authorizationRevoked are NOT here — they route to the
// per-target consumer (processGranteeActivities, Phase 4.1).
const activityWorkflows: Record<string, { workflow: Workflow; taskQueue: string }> = {
  roleMembershipChanged: { workflow: processRoleMembershipChange, taskQueue: 'create-grants' },
  roleDeleted: { workflow: processRoleDeletion, taskQueue: 'create-grants' },
  agentRegistrationAdded: {
    workflow: establishReciprocal,
    taskQueue: 'reciprocal-registration',
  },
}

const GRANTEE_ACTIVITY_TYPES = new Set(['authorizationRecorded', 'authorizationRevoked'])

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

      if (GRANTEE_ACTIVITY_TYPES.has(activity.activityType)) {
        // per-target consumer: deterministic workflowId per (webId, grantee).
        // start-or-signal-or-restart — if a consumer is already running, signal
        // it to wake up and drain the new activity; if it just terminated, the
        // signal fails and we start a fresh consumer (Phase 4.1)
        const authorizationGrantee = (
          activity.payload as { authorizationGrantee: { id: string; type: string[] } }
        ).authorizationGrantee
        const workflowId = `grantee:${channel.webId}:${authorizationGrantee.id}`
        const args: [CreateGrantsInput] = [
          {
            webId: { id: channel.webId, type: [INTEROP.SocialAgent] },
            authorizationGrantee,
          },
        ]
        const temporal = new Temporal()
        await temporal.init()
        const start = (): Promise<unknown> =>
          temporal.client!.workflow.start(processGranteeActivities, {
            taskQueue: 'create-grants',
            args,
            workflowId,
          })
        try {
          await start()
        } catch (err) {
          if (!(err instanceof WorkflowExecutionAlreadyStartedError)) throw err
          for (let attempt = 0; attempt < 3; attempt++) {
            try {
              await temporal.client!.workflow.getHandle(workflowId).signal(granteeActivitiesSignal)
              break
            } catch {
              // consumer closed between the failed start and the signal — restart it
              try {
                await start()
                break
              } catch (err2) {
                if (!(err2 instanceof WorkflowExecutionAlreadyStartedError)) throw err2
              }
            }
          }
        }
        return new ResponseDescription(200)
      }

      const entry = activityWorkflows[activity.activityType]
      if (entry) {
        const temporal = new Temporal()
        await temporal.init()
        // agentRegistrationAdded needs the accountId (the channel is per-account);
        // role workflows get the activity IRI to mark it done on success
        const args =
          activity.activityType === 'agentRegistrationAdded'
            ? [{ accountId: channel.accountId, ...(activity.payload as object) }]
            : [{ ...(activity.payload as object), activityIri: requestBody.object }]
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
