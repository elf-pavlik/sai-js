import { useAppStore } from '@/store/app'
import { getRuntimeConfig } from './runtime-config'

/**
 * Client for the always-open NDJSON event stream (`GET /.sai/events`),
 * driven by the activity lifecycle (pending → done) on the auth server
 * (see docs/plans/refactor-ui.md).
 *
 * - connects with the account cookie, like the RPC calls in store/core.ts
 * - parses NDJSON lines and dispatches completion-driven store refreshes
 * - auto-reconnects with backoff on error/close; heartbeat-timeout detection
 * - on first open and every reconnect triggers a full store refresh (the
 *   server never replays missed events — docs/plans/refactor-ui.md §5)
 */

interface ActivityEvent {
  id: string
  activityType: string
  target: string
  payload?: Record<string, unknown>
  createdAt: string
  status: 'pending' | 'done'
}

type StreamMessage =
  | { type: 'activity'; activity: ActivityEvent }
  | { type: 'heartbeat' }

const HEARTBEAT_INTERVAL_MS = 30_000
const HEARTBEAT_TIMEOUT_MS = HEARTBEAT_INTERVAL_MS * 3
const INITIAL_BACKOFF_MS = 1_000
const MAX_BACKOFF_MS = 30_000

const APPLICATION_TYPE = 'http://www.w3.org/ns/solid/interop#Application'

let controller: AbortController | null = null
let heartbeatWatchdog: ReturnType<typeof setInterval> | null = null
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
let backoff = INITIAL_BACKOFF_MS
let lastDataAt = 0
let stopped = false

/** The full store refresh run on first connect and on every reconnect. */
function fullRefresh() {
  const appStore = useAppStore()
  appStore.listSocialAgents(true)
  appStore.listApplications(true)
  appStore.listRoles(true)
  appStore.listSocialAgentInvitations(true)
}

/** The registry owner an activity was written to — `payload.webId` on every
 * activity (the producer's webId): a bare string on some shapes
 * (`agentRegistrationAdded`), `{ id, type }` on the rest. Phase 3 forwards
 * org-context activities onto the admin's stream keyed by the admin's webId
 * (R3 of org-admin-feature.md §3.3) — the UI must refresh only the context the
 * event belongs to.
 */
function registryOwner(activity: ActivityEvent): string | undefined {
  const webId = (activity.payload as { webId?: string | { id: string } } | undefined)?.webId
  if (!webId) return undefined
  return typeof webId === 'string' ? webId : webId.id
}

/**
 * Completion-driven refresh — maps the completed activity's type to the
 * store refetches (§5 of the plan). `pending` events are ignored for now
 * (optional "applying changes…" indicator, out of scope).
 */
function handleActivity(activity: ActivityEvent) {
  if (activity.status !== 'done') return
  const appStore = useAppStore()
  // org-context events arrive on the admin's stream for every org the user
  // administers — refresh only the context that owns the activity; switching
  // contexts already performs a full refresh (switchContext)
  const owner = registryOwner(activity)
  if (owner && appStore.currentContext() !== owner) return
  switch (activity.activityType) {
    case 'authorizationRecorded':
    case 'authorizationRevoked': {
      const grantee = activity.payload?.authorizationGrantee as
        | { id: string; type: string[] }
        | undefined
      const isApplication = grantee?.type?.includes(APPLICATION_TYPE)
      if (isApplication) appStore.listApplications(true)
      else appStore.listSocialAgents(true)
      break
    }
    case 'roleMembershipChanged':
    case 'roleDeleted':
      appStore.listSocialAgents(true)
      appStore.listRoles(true)
      break
    case 'agentRegistrationAdded':
      appStore.listSocialAgents(true)
      appStore.listSocialAgentInvitations(true)
      break
    case 'delegatedGrantsUpdated':
    case 'grantsRevoked':
      appStore.listSocialAgents(true)
      break
    // org-admin (Phase 1/3): the admin marker lands via the grant workflow —
    // refresh the context's agent list so toggle-admin flags stay current
    case 'adminAuthorizationRecorded':
    case 'adminAuthorizationRevoked':
      appStore.listSocialAgents(true)
      break
  }
}

function handleMessage(line: string) {
  if (!line) return
  try {
    const message = JSON.parse(line) as StreamMessage
    if (message.type === 'activity') handleActivity(message.activity)
  } catch {
    // a malformed line must not break the stream
  }
}

function scheduleReconnect() {
  if (stopped) return
  clearTimers()
  reconnectTimer = setTimeout(() => {
    void open()
  }, backoff)
  backoff = Math.min(backoff * 2, MAX_BACKOFF_MS)
}

function clearTimers() {
  if (heartbeatWatchdog) clearInterval(heartbeatWatchdog)
  if (reconnectTimer) clearTimeout(reconnectTimer)
  heartbeatWatchdog = null
  reconnectTimer = null
}

async function open() {
  if (stopped) return
  controller = new AbortController()
  try {
    const response = await fetch(`${getRuntimeConfig().backendBaseUrl}/.sai/events`, {
      credentials: 'include',
      signal: controller.signal,
    })
    if (!response.ok || !response.body) throw new Error(`stream returned ${response.status}`)

    backoff = INITIAL_BACKOFF_MS
    lastDataAt = Date.now()
    fullRefresh()

    // heartbeat-timeout detection: no data for several heartbeats → the
    // connection is dead; abort it so the close handler schedules a reconnect
    heartbeatWatchdog = setInterval(() => {
      if (Date.now() - lastDataAt > HEARTBEAT_TIMEOUT_MS) controller?.abort()
    }, HEARTBEAT_INTERVAL_MS)

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      lastDataAt = Date.now()
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) handleMessage(line)
    }
  } catch {
    // aborted (timeout/stop) or network error — reconnect unless stopped
  } finally {
    if (!stopped) scheduleReconnect()
  }
}

/** Open the stream (after sign-in — `coreStore.userId` set). */
export function startEvents() {
  stopped = false
  void open()
}

/** Close the stream (on sign-out / unmount). */
export function stopEvents() {
  stopped = true
  clearTimers()
  controller?.abort()
  controller = null
}