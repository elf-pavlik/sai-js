import type { AuthorizationAgent } from '@janeirodigital/interop-authorization-agent'
import { ActivityRegistry } from '@janeirodigital/interop-authorization-agent'
import type { ActivityCompleted, ActivityData } from '@janeirodigital/interop-data-model'
import { isActivityClass, loadDataAuthorization } from '@janeirodigital/interop-data-model'
import { INTEROP } from '@janeirodigital/interop-utils'
import {
  AdminAuthorizationRecorded,
  AdminAuthorizationRevoked,
  AgentRegistrationAdded,
  AuthorizationRecorded,
  AuthorizationRevoked,
  DelegatedGrantsUpdated,
  GrantsRevoked,
  InvitationAccepted,
  InvitationCreated,
  RoleDeleted,
  RoleMembershipChanged,
} from '@janeirodigital/sai-api-messages'
import {
  BadRequestHttpError,
  NotFoundHttpError,
  OperationHttpHandler,
  ResponseDescription,
  readableToString,
} from '@solid/community-server'
import type { OperationHttpHandlerInput } from '@solid/community-server'
import { WorkflowExecutionAlreadyStartedError } from '@temporalio/client'
import * as S from 'effect/Schema'
import { getLoggerFor } from 'global-logger-factory'
import type { ActivityEvents } from './ActivityEvents.js'
import type { ActivityWebhookStore } from './ActivityWebhookStore.js'
import type { SessionManager } from './SessionManager'
import type { CreateGrantsInput } from './temporal/activities/grants.js'
import type { ReciprocalWebhookInput } from './temporal/activities/reciprocal.js'
import { Temporal } from './temporal/client.js'
import {
  processAdminAuthorizationRecorded,
  processAdminAuthorizationRevoked,
} from './temporal/workflows/admin.js'
import {
  granteeActivitiesSignal,
  processGranteeActivities,
  processGrantsRevocation,
  processRoleDeletion,
  processRoleMembershipChange,
  updateDelegatedGrants,
} from './temporal/workflows/grants.js'
import { createInvitation } from './temporal/workflows/invitation.js'
import { acceptInvitation, establishReciprocal } from './temporal/workflows/reciprocal.js'

/** The webhook channel (owner or admin subscription) for the current topic. */
type ActivityChannel = NonNullable<Awaited<ReturnType<ActivityWebhookStore['findBySendTo']>>>

/** Brand a plain webId as a SocialAgent ref (refs exist only in temporal inputs). */
const socialAgentRef = (id: string): { id: string; type: string[] } => ({
  id,
  type: [INTEROP.SocialAgent],
})

/**
 * Receives webhook notifications from an Activity Registry container
 * subscription. On `Add` (an activity resource was PUT), fetches the activity,
 * dispatches on the `type` discriminant (schema-decoded — malformed activities
 * fail fast), and starts the matching workflow with the activity's
 * plain-IRI/object fields. grantee activities (authorizationRecorded/
 * authorizationRevoked) join the per-target consumer; admin activities
 * (adminAuthorizationRecorded/adminAuthorizationRevoked) run the sequential
 * orchestrator (grants → ACR rewrite → mark done).
 */
export class ActivityWebhookHandler extends OperationHttpHandler {
  protected readonly logger = getLoggerFor(this)
  public constructor(
    private readonly activityWebhookStore: ActivityWebhookStore,
    private readonly sessionManager: SessionManager,
    private readonly activityEvents: ActivityEvents
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
      const activity = await ActivityRegistry.loadActivity(requestBody.object, session.fetch)

      // Forward to the events bus BEFORE dispatch — every Add produces a line,
      // including grantee activities (whose branch returns 200 early below).
      // Change activities → `pending`; `activityCompleted` → load the completed
      // activity via `target` → `done` (enrichment: the completion resource is
      // minimal, the original's typed fields are what the UI needs).
      await this.forwardActivity(activity, session, channel.webId)

      // Owner vs admin (observer) channel (§3.1 of org-admin-feature.md): a
      // channel whose webId is NOT the owner of the Activity Registry at
      // `channel.topic` is an admin's subscription — it receives the
      // forwarding half only. The org's owner subscription keeps running the
      // workflows; events stay keyed by the channel's webId, so the admin
      // channel delivers them into the admin's own UI stream.
      const isRegistryOwner = session.registrySet.hasActivityRegistry?.id === channel.topic
      if (!isRegistryOwner) return new ResponseDescription(200)

      const temporal = new Temporal()
      await temporal.init()
      await this.dispatch(activity, channel, session, temporal)
    }
    return new ResponseDescription(200)
  }

  /** The grantee of a live-link DataAuthorization object (kind via the store).
   *  404-tolerant — an intervening deny may have deleted the DA before the
   *  webhook dispatched the granted activity. */
  private async granteeFromDataAuthorization(
    id: string | undefined,
    session: AuthorizationAgent
  ): Promise<Awaited<ReturnType<AuthorizationAgent['typeGrantee']>> | undefined> {
    if (!id) return undefined
    try {
      const authorization = await loadDataAuthorization(id, session.fetch)
      return session.typeGrantee(authorization.grantee)
    } catch {
      return undefined
    }
  }

  /** Route one activity to its workflow(s) — one branch per activity class. */
  private async dispatch(
    activity: ActivityData,
    channel: ActivityChannel,
    session: AuthorizationAgent,
    temporal: Temporal
  ): Promise<void> {
    const client = temporal.client!

    if (isActivityClass(activity, 'InvitationAccepted')) {
      // the acceptor's AA runs the accept itself (POST the opaque capabilityUrl,
      // build acceptor → inviter + reciprocal) — personal and org contexts alike.
      // The object is a urn:uuid snapshot embedded in the activity doc. The
      // decoded object passes verbatim; accountId rides for the webhook store
      // (this is a webhook/push type per the checklist).
      const decoded = S.decodeUnknownSync(InvitationAccepted)(activity)
      await client.workflow.start(acceptInvitation, {
        taskQueue: 'reciprocal-registration',
        args: [
          channel.webId,
          { ...decoded.object, type: [...decoded.object.type] },
          channel.accountId,
          { id: activity.id, type: [...decoded.type] },
        ],
        workflowId: crypto.randomUUID(),
      })
      return
    }

    if (isActivityClass(activity, 'InvitationCreated')) {
      // step 1 — the send leg: the RPC pre-minted the invitation id and wrote
      // the activity (object = the invitation-to-be, full POJO minus
      // capabilityUrl); this workflow PUTs the invitation resource at that id
      // with the channel session, generates the capabilityUrl there and
      // completes. Not a webhook/push type — no accountId pass-through.
      const decoded = S.decodeUnknownSync(InvitationCreated)(activity)
      await client.workflow.start(createInvitation, {
        taskQueue: 'create-grants',
        args: [
          channel.webId,
          // the object IS the invitation-to-be (CreateInvitationPojo) — the
          // decoded activity object passes verbatim into the workflow input
          // (the schema decodes `type` as readonly — spread to mutable)
          { ...decoded.object, type: [...decoded.object.type] },
          // the triggering activity as a typed ref — traceable completion
          // (the schema decodes `type` as readonly — spread to the mutable
          // data-model tuple the InvitationCreatedId ref expects)
          { id: activity.id, type: [...decoded.type] },
        ],
        workflowId: crypto.randomUUID(),
      })
      return
    }

    if (isActivityClass(activity, 'AgentRegistrationAdded')) {
      const decoded = S.decodeUnknownSync(AgentRegistrationAdded)(activity)
      await client.workflow.start(establishReciprocal, {
        taskQueue: 'reciprocal-registration',
        args: [
          channel.webId,
          { ...decoded.object, type: [...decoded.object.type] },
          channel.accountId,
          { id: activity.id, type: [...decoded.type] },
        ],
        workflowId: crypto.randomUUID(),
      })
      return
    }

    if (
      isActivityClass(activity, 'AuthorizationRecorded') ||
      isActivityClass(activity, 'AuthorizationRevoked')
    ) {
      // per-target consumer: deterministic workflowId per (webId, grantee).
      // start-or-signal-or-restart — if a consumer is already running, signal
      // it to wake up and drain the new activity; if it just terminated, the
      // signal fails and we start a fresh consumer (Phase 4.1). The grantee is
      // read from the object (parties ride the object; kind via the store):
      // granted → the first live-link DataAuthorization; denied → the
      // embedded structure snapshot (no DataAuthorization is created).
      const decoded = isActivityClass(activity, 'AuthorizationRecorded')
        ? S.decodeUnknownSync(AuthorizationRecorded)(activity as never)
        : S.decodeUnknownSync(AuthorizationRevoked)(activity as never)
      const authorizationGrantee = Array.isArray(decoded.object)
        ? await this.granteeFromDataAuthorization(decoded.object[0], session)
        : await session.typeGrantee((decoded.object as { grantee: string }).grantee)
      if (!authorizationGrantee) return
      const workflowId = `grantee:${channel.webId}:${authorizationGrantee.id}`
      const args: [CreateGrantsInput] = [
        { webId: socialAgentRef(channel.webId), authorizationGrantee },
      ]
      const start = (): Promise<unknown> =>
        client.workflow.start(processGranteeActivities, {
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
            await client.workflow.getHandle(workflowId).signal(granteeActivitiesSignal)
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
      return
    }

    if (
      isActivityClass(activity, 'AdminAuthorizationRecorded') ||
      isActivityClass(activity, 'AdminAuthorizationRevoked')
    ) {
      if (isActivityClass(activity, 'AdminAuthorizationRecorded')) {
        // step 5 — the object IS the AdminAuthorization-to-be (real-id
        // embedded projection at the PRE-MINTED id); the decoded object
        // passes verbatim into the workflow input (the schema decodes
        // arrays as readonly — spread to mutable)
        const decoded = S.decodeUnknownSync(AdminAuthorizationRecorded)(activity as never)
        await client.workflow.start(processAdminAuthorizationRecorded, {
          taskQueue: 'create-grants',
          args: [
            socialAgentRef(channel.webId),
            { ...decoded.object, type: [...decoded.object.type] },
            // the triggering activity as a typed ref — traceable completion
            { id: activity.id, type: [...decoded.type] },
          ],
          workflowId: crypto.randomUUID(),
        })
      } else {
        // step 6 — the object IS the existing AdminAuthorization (real-id
        // embedded projection at its id); the removeAdmin workflow DELETEs
        // it, revokes grants + the ACR rewrite, then completes
        const decoded = S.decodeUnknownSync(AdminAuthorizationRevoked)(activity as never)
        await client.workflow.start(processAdminAuthorizationRevoked, {
          taskQueue: 'create-grants',
          args: [
            socialAgentRef(channel.webId),
            { ...decoded.object, type: [...decoded.object.type] },
            { id: activity.id, type: [...decoded.type] },
          ],
          workflowId: crypto.randomUUID(),
        })
      }
      return
    }

    if (isActivityClass(activity, 'RoleMembershipChanged') || isActivityClass(activity, 'RoleDeleted')) {
      // steps 2–3 — the object IS the role-to-be (real-id embedded
      // projection); the decoded object passes verbatim into the workflow
      // input (the schema decodes arrays as readonly — spread to the mutable
      // RoleData); the triggering activity rides as a typed ref
      if (isActivityClass(activity, 'RoleMembershipChanged')) {
        const decoded = S.decodeUnknownSync(RoleMembershipChanged)(activity as never)
        await client.workflow.start(processRoleMembershipChange, {
          taskQueue: 'create-grants',
          args: [
            socialAgentRef(channel.webId),
            {
              ...decoded.object,
              type: [...decoded.object.type],
              members: [...decoded.object.members],
            },
            { id: activity.id, type: [...decoded.type] },
          ],
          workflowId: crypto.randomUUID(),
        })
      } else {
        const decoded = S.decodeUnknownSync(RoleDeleted)(activity as never)
        await client.workflow.start(processRoleDeletion, {
          taskQueue: 'create-grants',
          args: [
            socialAgentRef(channel.webId),
            {
              ...decoded.object,
              type: [...decoded.object.type],
              members: [...decoded.object.members],
            },
            { id: activity.id, type: [...decoded.type] },
          ],
          workflowId: crypto.randomUUID(),
        })
      }
      return
    }

    if (isActivityClass(activity, 'DelegatedGrantsUpdated')) {
      const decoded = S.decodeUnknownSync(DelegatedGrantsUpdated)(activity)
      await client.workflow.start(updateDelegatedGrants, {
        taskQueue: 'create-grants',
        args: [
          {
            webId: socialAgentRef(channel.webId),
            peerId: socialAgentRef(decoded.target),
            activityId: activity.id,
          },
        ],
        workflowId: crypto.randomUUID(),
      })
      return
    }

    if (isActivityClass(activity, 'GrantsRevoked')) {
      const decoded = S.decodeUnknownSync(GrantsRevoked)(activity)
      const grantee = await session.typeGrantee(decoded.grantee)
      await client.workflow.start(processGrantsRevocation, {
        taskQueue: 'create-grants',
        args: [
          {
            webId: socialAgentRef(channel.webId),
            grantee,
            dataOwner: decoded.dataOwner,
            grants: decoded.object.map((id) => ({ id, type: [INTEROP.DataGrant] })),
            activityId: activity.id,
          },
        ],
        workflowId: crypto.randomUUID(),
      })
      return
    }
  }

  /**
   * The forwarding half shared by owner and admin channels — §3.1 of
   * org-admin-feature.md: emit `pending` for a change activity, or load the
   * completed activity via `target` and emit `done` for an `activityCompleted`
   * (enrichment: the completion resource is minimal, the original's typed
   * fields are what the UI needs). Keyed by the channel's `webId` — the org
   * for owner channels, the admin for admin channels, so org-context events
   * reach the admin's own event stream.
   */
  private async forwardActivity(
    activity: ActivityData,
    session: AuthorizationAgent,
    webId: string
  ): Promise<void> {
    if (isActivityClass(activity, 'ActivityCompleted')) {
      try {
        const completed = await ActivityRegistry.loadActivity(
          (activity as ActivityCompleted).target,
          session.fetch
        )
        this.activityEvents.onActivityAdded(webId, { ...completed, status: 'done' })
      } catch (err) {
        this.logger.error(
          `Failed to load completed activity ${(activity as ActivityCompleted).target}: ${
            (err as Error).message
          }`
        )
      }
    } else {
      this.activityEvents.onActivityAdded(webId, { ...activity, status: 'pending' })
    }
  }
}