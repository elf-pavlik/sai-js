# Webhook subscription bootstrap & reconciliation (real deployments)

> **Status:** design only — extracted from `workflow-temporal-decupling.md` Phase
> 3 into this standalone, more detailed plan. Covers creating and healing the
> **Activity Registry webhook subscription** (app store + CSS-side channel) for
> accounts that are **not** covered by the dev/test pre-seed.

## 1. Problem

In dev and test the Activity Registry webhook channels are **pre-seeded** in
`environments/data/kv.json` (app store `**activityWebhook**` + CSS-side
`notifications/…` keys, deterministic sendTo). **Real deployments have no
pre-seed** — accounts are created at runtime via `AccountService.bootstrapAccount`,
so the main agent of a fresh account has **no subscription** to its own Activity
Registry container:

- producers PUT activities, but CSS has no webhook channel for the container →
  no notification → the handler never runs → every activity sits `pending`
  until the reconciliation sweep (Phase 4.2) notices — or forever if nothing
  triggers it.
- channels can also be **lost or corrupted** at runtime (manual kv edits, a
  partial restore, a failed subscribe) — the app-store entry and the CSS-side
  channel are two separate pieces of state and can diverge.

## 2. Goal

1. **On account creation** — the main agent is subscribed to its own Activity
   Registry container (app store + CSS channel), idempotently.
2. **Healing** — at worker startup (and periodically) every account is checked:
   app-store entry present? CSS-side channel present? Create what's missing
   (create-if-missing), never duplicate.
3. Deterministic sendTo only where it matters (tests/dev pre-seed); production
   uses a fresh random sendTo per creation.

## 3. Current wiring (as-is)

| Piece | Where | Notes |
|---|---|---|
| Pre-seeded channels (dev/test) | `environments/data/kv.json` — `**activityWebhook**` account entries + `accounts/index/activityWebhook/*` + CSS-side `notifications/<encodeURIComponent(id\|topic)>` keys | alice/bob/kim; re-seeded by `beforeEach` |
| App store | `ActivityWebhookStore` (`packages/components/src/ActivityWebhookStore.ts`) over `AccountLoginStorage` — type `activityWebhook`, fields `accountId/webId/topic/sendTo/channel`; methods today: `findBySendTo`, `create`, `delete` | needs `findByWebId`/`findByTopic` for reconciliation |
| CSS-side channel | created by `SubscriptionClient.subscribe(topic, ChannelType.WebhookChannel2023, sendTo)` → the registry server's `KeyValueChannelStorage` (`notifications/…` keys) | the pattern in `activities/reciprocal.ts` `reciprocalWebhook` |
| Account creation | `AccountService.bootstrapAccount` (`packages/components/src/services/Account.ts`) — POSTs `registrySetTemplate` (incl. the activity registry) to the quadstore + writes the account to kv | runs on the auth server; no subscription today |
| Session for subscribing | `buildSessionManager().getSession(webId)` (worker) / `buildOidcSession(webId)` — DPoP-bound `session.fetch` | the reciprocal activity uses the worker session |
| Worker env | has `CSS_POSTGRES_CONNECTION_STRING`, `CSS_BASE_URL`, `CSS_ENCODED_PRIVATE_JWK`, `TEMPORAL_ADDRESS` | enough to build the session + store + Temporal client — **no new env needed** |

## 4. Target design

### 4.1 `ensureActivityWebhookChannel` activity (in `packages/components/src/temporal/activities/`)

Mirror `reciprocalWebhook` (activities/reciprocal.ts) but for the Activity
Registry:

```ts
export interface EnsureActivityWebhookChannelInput {
  accountId: string
  webId: string
  topic: string   // the agent's Activity Registry container IRI
}

export async function ensureActivityWebhookChannel(
  payload: EnsureActivityWebhookChannelInput
): Promise<void> {
  const store = new ActivityWebhookStore(await buildAccountLoginStorage())
  await store.handle()
  const existing = await store.findByTopic(payload.topic)      // new method
  if (existing) return                                          // idempotent — skip

  const manager = buildSessionManager()
  const session = await manager.getSession(payload.webId)
  const subscriptionClient = new SubscriptionClient(session.fetch)
  const channel = await subscriptionClient.subscribe(
    payload.topic,
    ChannelType.WebhookChannel2023,
    webhookTargetUrl()   // fresh random uuid — production determinism is not needed
  )
  await store.create(payload.accountId, payload.webId, payload.topic, channel)
}
```

- **Idempotent**: if the app store already has a channel for the topic, skip
  entirely (covers the pre-seeded dev/test accounts too — no duplication).
- **Creates both sides atomically-enough**: `subscribe` creates the CSS-side
  channel; `store.create` records the app side.
- A 4xx from the registry server's notification endpoint (topic not found) is
  retried by Temporal — the activity registry is created just before in
  `bootstrapAccount`, so the retry covers the ordering.

### 4.2 `ensureActivityWebhookChannel` workflow

```ts
export async function ensureActivityWebhookChannel(payload: EnsureActivityWebhookChannelInput): Promise<void> {
  const { ensureActivityWebhookChannel } = proxyActivities<typeof activities>({
    startToCloseTimeout: '1 minute',
    retry: { initialInterval: '1s', backoffCoefficient: 2, maximumInterval: '60s', maximumAttempts: 10 },
  })
  await ensureActivityWebhookChannel(payload)
}
```

### 4.3 Hook on account creation

`AccountService.bootstrapAccount`, after the registry-set trig POST (and the kv
account write), **starts** the workflow fire-and-forget (same Temporal client
pattern as `GrantIssuanceHandler`):

```ts
const temporal = new Temporal()
await temporal.init()
await temporal.client.workflow.start(ensureActivityWebhookChannel, {
  taskQueue: 'reciprocal-registration',   // or a dedicated queue — see §5.3
  args: [{
    accountId,
    webId,
    topic: `${registrySet}activity/`,     // the activity registry container
  }],
  workflowId: `activity-webhook:${accountId}`,
})
```

Idempotent by construction: re-running bootstrap (or a retry) hits
`findByTopic` and skips.

### 4.4 Startup + periodic reconciliation (healing)

A sweep workflow `reconcileActivityWebhookChannels` (distinct from the activity
**entry** sweep in Phase 4.2 — this one heals *channels*, not *entries*):

1. **Enumerate accounts/webIds** — iterate the kv (`PostgresKeyValueStorage`
   `entries()`) over the `webIdLink` index or `accounts/data/*`; for each
   account with a registry set, the topic is `<registrySet>activity/` (or read
   via a session: `session.registrySet.hasActivityRegistry.id`).
2. Per (accountId, webId, topic):
   - **App store missing** → run `ensureActivityWebhookChannel` (creates both).
   - **App store present but CSS channel missing** → re-subscribe with the
     **same sendTo** (keeps the app entry valid for the handler) and update the
     app entry's `channel` JSON; or, simpler, delete the app entry and
     re-create fresh (new sendTo) — either is correct, pick per deployment
     (deterministic sendTo in dev/test favors "re-subscribe same sendTo").
3. Run at **worker startup** (accounts discovered from kv) and **periodically**
   (a timer-loop workflow, reusing the Phase 4.2 scheduling pattern), so lost
   channels self-heal.

### 4.5 Determinism note (3.3)

- **Pre-seeded (dev/test)**: fixed sendTo per account — the tests POST/await
  real CSS delivery against them (§3.5 of the main plan).
- **Real deployments**: fresh random sendTo per creation — nothing depends on a
  known sendTo; the handler finds the channel by the sendTo it was POSTed to.

## 5. Design decisions

### 5.1 Why a Temporal workflow (not inline in `bootstrapAccount`)

Durable + retried: if the subscribe POST fails transiently, the workflow retries
(and the activity registry container exists by then). Also keeps the subscribe
logic in one place (worker activities) with the session machinery, instead of
duplicating it on the auth server.

### 5.2 Idempotency against the pre-seed

`findByTopic` short-circuits — pre-seeded dev/test accounts are never
re-subscribed or duplicated; a hand-created production account is subscribed
exactly once (first bootstrap), then skipped.

### 5.3 Task queue

The `ensureActivityWebhookChannel` workflow can run on `reciprocal-registration`
(its activity is structurally identical to `reciprocalWebhook`) or a dedicated
`webhook-subscription` queue. Either works; pick one and register the workflow
+ activities in `workers/main.ts`.

### 5.4 CSS-channel healing semantics

The app store and the CSS channel can diverge (restore, manual edit). The sweep
treats the **app store as the source of truth for the sendTo** and repairs the
CSS side to match (re-subscribe same sendTo) — the handler only needs the app
entry's sendTo/webId/topic to function, so healing the CSS side is what
restores delivery.

## 6. Tests

- **New**: bootstrap a fresh account via the `bootstrapAccount` RPC
  (or `checkHandle` + `bootstrapAccount`), then assert the app-store entry
  exists (`ActivityWebhookStore.findByTopic`) **and** the CSS-side channel key
  exists (read kv `notifications/<encodeURIComponent(channel.id)>`).
- **Idempotency**: bootstrap the same account twice → still exactly one entry.
- **Healing**: delete the CSS-side kv key for a pre-seeded account → run the
  sweep → the channel is recreated and CSS delivery works (assert via the
  existing listen-await-assert pattern on a real activity).
- Existing suite stays green: the pre-seeded accounts are untouched by the
  create path (idempotent skip) and the heal path only runs on demand.

## 7. Out of scope

- The reconciliation sweep for activity **entries** (Phase 4.2) — separate.
- Durable webhook **delivery** (`durable-webhook-delivery.md`) — separate.
- Unsubscribing channels for deleted accounts (no account-deletion flow today).
- Reciprocal webhook channels (created per-peer by `establishReciprocal` at
  runtime — already bootstrapped by their own workflow).
