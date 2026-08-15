# Durable webhook delivery

> **Status:** design only — extracted from `workflow-temporal-decupling.md` §4.3
> (Phase 4.3) into this standalone, more detailed plan. Applies to the **registry**
> and **data** CSS servers (the only servers with notifications enabled) and
> reuses the existing Temporal worker.

## 1. Problem

CSS v8's default `WebhookEmitter` POSTs each webhook notification to the
channel's `sendTo` **once, fire-and-forget**:

```js
const response = await fetch(webhookChannel.sendTo, { method: 'POST', ... })
if (response.status >= 400) this.logger.error(`There was an issue emitting ...`)
```

- A failed POST (network blip, receiver down, 5xx) is logged and **dropped** —
  no retry.
- This is the largest remaining delivery gap in the activity-webhook design:
  a missed `Add` notification means the producer's activity sits `pending` in
  the Activity Registry and only the reconciliation sweep (Phase 4.2) would
  ever process it — minutes/hours late, or never if the activity's follow-up
  is time-sensitive.
- The same applies to **any** webhook channel on the registry or data servers
  (e.g. future subscriptions on data-registry topics), not just the Activity
  Registry.

## 2. Goal

Make webhook delivery **durable via Temporal**: the emitter enqueues a
`deliverWebhook` workflow instead of POSTing directly; the workflow's activity
POSTs the notification with an explicit **retry policy** (backoff, bounded
attempts) and marks 4xx as non-retryable. The notification is only considered
delivered when the POST succeeds (or attempts are exhausted — then it's a
`pending` activity for the reconciliation sweep to recover).

## 3. Current wiring (as-is)

| Piece | Where | Notes |
|---|---|---|
| `WebhookEmitter` instantiated | `css:config/http/notifications/webhooks/handler.json` → `urn:solid-server:default:WebhookEmitter` (`baseUrl`, `webIdRoute`, `jwkGenerator`, `expiration=20`) | the class: `@solid/community-server/dist/server/notifications/WebhookChannel2023/WebhookEmitter.js` |
| Servers with notifications enabled | **registry** (`packages/components/config/registry.json`) and **data** (`packages/components/config/data.json`) — both import `css:config/http/notifications/all.json` | the **auth** server imports `css:config/http/notifications/disabled.json` — no emitter there |
| Delivery pipeline | `MonitoringStore` → `ListeningActivityHandler` → `NotificationHandler` (`WebhookNotificationHandler` = `TypedNotificationHandler` → `ComposedNotificationHandler`: generator `AddRemoveNotificationGenerator` → serializer → `WebhookEmitter`) | channels read from the kv-backed `SubscriptionStorage` (`KeyValueChannelStorage`, `notifications/…` keys) |
| Worker | `packages/components/src/workers/main.ts` — `forward-to-push` task queue (workflow `sendPushNotifications`, activity `forwardToPush`), `reciprocal-registration`, `create-grants` | the delivery workflow joins this worker |
| Emitter's DPoP token | signed by the server's `urn:solid-server:default:JwkGenerator` (registry/data use CSS's kv-backed `CachedJwkGenerator` over `idp/keys/jwks`), subject = `WebhookWebIdRoute` path, issuer = trimmed `baseUrl` | receivers (our handlers) do **not** verify it today (`TODO: check if sender matches` in `ReciprocalWebhookHandler`/`ActivityWebhookHandler`) |
| Env | registry/data get `CSS_POSTGRES_CONNECTION_STRING`, `CSS_SPARQL_ENDPOINT`, certs (+ garage for data) — **no `TEMPORAL_ADDRESS`** | must be added (docker-compose + dagger) |

## 4. Target design

### 4.1 `DurableWebhookEmitter` (in `packages/components`)

Extends CSS's `WebhookEmitter` (reuses `canHandle` + the DPoP token/proof
generation). Overrides `handle({ channel, representation })`:

1. Serialize the notification body once (`readableToString(representation.data)`)
   and capture `representation.metadata.contentType`.
2. Generate the DPoP token + proof **exactly as today** (same JWK, issuer,
   webId, `htu`/`htm`), so the outgoing request is indistinguishable from
   today's — receivers that verify later won't notice the change.
3. Start (fire-and-forget from CSS's perspective — do **not** await completion)
   the `deliverWebhook` workflow on the delivery task queue:
   ```ts
   await temporal.client.workflow.start(deliverWebhook, {
     taskQueue: WEBHOOK_DELIVERY_TASK_QUEUE,   // env, default 'forward-to-push'
     args: [{ sendTo, body, contentType, dpopToken, dpopProof }],
     workflowId: `webhook:${sendTo}:${crypto.randomUUID()}`,
   })
   ```
   (deterministic per-channel prefix only — see §5.4 for serialization options)

### 4.2 `deliverWebhook` workflow + `postWebhook` activity

In the `forward-to-push` worker files (same task queue; a dedicated task queue
is an option, §5.3):

```ts
// activities/forward-to-push.ts (or a new delivery.ts)
export interface PostWebhookInput {
  sendTo: string
  body: string
  contentType: string
  authorization?: string   // `DPoP <token>` — passed through from the emitter
  dpop?: string            // proof
}
export async function postWebhook(payload: PostWebhookInput): Promise<void> {
  const response = await fetch(payload.sendTo, {
    method: 'POST',
    headers: {
      'content-type': payload.contentType,
      ...(payload.authorization ? { authorization: payload.authorization } : {}),
      ...(payload.dpop ? { dpop: payload.dpop } : {}),
    },
    body: payload.body,
  })
  if (response.status >= 400) {
    // 4xx = the channel/handler is gone or rejects — retrying is futile
    // 5xx / network errors = transient — let the retry policy handle them
    if (response.status < 500) throw ApplicationFailure.nonRetryable(...)
    throw new Error(`webhook delivery failed: ${response.status} ${payload.sendTo}`)
  }
}
```

```ts
// workflows/forward-to-push.ts
const { postWebhook } = proxyActivities<typeof activities>({
  startToCloseTimeout: '1 minute',
  retry: {
    initialInterval: '1s',
    backoffCoefficient: 2,
    maximumInterval: '60s',
    maximumAttempts: 10,   // ~17 min of backoff — bounded, see §5.2
  },
})
export async function deliverWebhook(payload: PostWebhookInput): Promise<void> {
  await postWebhook(payload)
}
```

### 4.3 Config override (in `packages/components/config`)

Mirror the `jwks.json` override pattern — new
`packages/components/config/overrides/emitter.json`:

```json
{
  "@id": "urn:sai:default:OverrideWebhookEmitter",
  "@type": "Override",
  "overrideInstance": { "@id": "urn:solid-server:default:WebhookEmitter" },
  "overrideParameters": {
    "@type": "DurableWebhookEmitter",
    "baseUrl": { "@id": "urn:solid-server:default:variable:baseUrl" },
    "webIdRoute": { "@id": "urn:solid-server:default:WebhookWebIdRoute" },
    "jwkGenerator": { "@id": "urn:solid-server:default:JwkGenerator" },
    "expiration": 20
  }
}
```

Imported by **`registry.json`** and **`data.json`** (not `auth.json` — its
notifications are disabled). The custom class is picked up by the existing
`componentsjs-generator` (exported from the components index).

### 4.4 Environment variables

`TEMPORAL_ADDRESS` must reach the **registry** and **data** CSS servers (the
emitter builds the Temporal client from it):

- **docker-compose**: add `*temporal-env` (`TEMPORAL_ADDRESS: temporal:7233`) to
  the `registry` and `data` services' `environment` arrays (they currently get
  only postgres/sparql/certs (+ garage for data)).
- **dagger** (`.dagger/src/index.ts`): add
  `.withEnvVariable('TEMPORAL_ADDRESS', 'temporal:7233')` to `registryService()`
  and `dataService()` (auth/worker already have it).
- Optional: `WEBHOOK_DELIVERY_TASK_QUEUE` (default `'forward-to-push'`) if a
  dedicated queue is chosen (§5.3).

## 5. Design decisions

### 5.1 DPoP token: generated emitter-side, passed through

The emitter generates the token/proof once (same JWK as today) and the workflow
passes them to the activity unchanged. Retries reuse the same token — valid
`expiration` minutes (default 20). Since our receivers don't verify the sender,
expiry during a long retry window is cosmetic today.

**Spec-correct follow-up (documented, not blocking):** have `postWebhook`
regenerate the token at send time. The activity runs in the worker, which has
`CSS_POSTGRES_CONNECTION_STRING` — it can build the same kv-backed
`CachedJwkGenerator` (`ContainerPathStorage('/idp/keys/', KeyValueStorage)`,
storageKey `jwks`) as the CSS server, so the token is signed by the same key
with a fresh timestamp per attempt. Requires the emitter to also pass
`baseUrl` + `webId` (the `WebhookWebIdRoute` path).

### 5.2 Retry policy

- **Transient** (network, 5xx): Temporal retry — `1s` initial, `×2` backoff,
  `60s` max, **10 attempts** (~17 min). Bounded so a permanently-down receiver
  doesn't hammer it; the reconciliation sweep is the eventual backstop.
- **4xx**: `ApplicationFailure.nonRetryable` — the channel/handler is gone or
  rejects; retrying is futile (and the handler's own `404` on an unknown
  `sendTo` is exactly that). The channel should eventually be unsubscribed
  (existing `TODO: unsubscribe` in the handlers).

### 5.3 Worker / task queue

Add `deliverWebhook` + `postWebhook` to the existing **`forward-to-push`**
worker (it is already the "outbound HTTP" worker and the only worker that
doesn't need a registry session). A dedicated `webhook-delivery` task queue is
the alternative if push and webhook delivery should have independent
scaling/concurrency — not needed now.

### 5.4 Ordering

Today each delivery is an independent POST; out-of-order delivery is absorbed by
idempotent full regeneration (§6.4/6.11 of the main plan). If strict
per-channel ordering is ever required, use a **deterministic `workflowId` per
`sendTo`** (`webhook:${sendTo}`) — Temporal serializes workflow executions per
id, so deliveries for one channel process sequentially. Default:
random suffix (parallel, unordered), matching today.

### 5.5 What happens to the existing direct tests

`reciprocal-webhook.test.ts` POSTs to the handler directly (simulating the
peer) — unchanged. The activity-webhook tests rely on real CSS delivery
(Phase 2); with the durable emitter, delivery goes through `deliverWebhook`
instead of the raw emitter — the tests still pass as long as the **forward-to-
push worker runs in the test stack** (it does) and the registry/data servers
have `TEMPORAL_ADDRESS` (added in §4.4). Delivery latency grows by a
workflow-start round trip — the tests already await the registration `Update`,
so no test-timing change.

## 6. Implementation steps

1. **Worker** (`packages/components/src/temporal/`): add `postWebhook` activity
   + `deliverWebhook` workflow (in the `forward-to-push` files or a new
   `delivery` module registered on the same task queue in `workers/main.ts`).
2. **Emitter** (`packages/components/src/`): `DurableWebhookEmitter extends
   WebhookEmitter` — override `handle` to serialize + generate tokens + start
   the workflow; export from the index.
3. **Config**: `packages/components/config/overrides/emitter.json` (Override of
   `urn:solid-server:default:WebhookEmitter`); import it in
   `config/registry.json` and `config/data.json`.
4. **Env**: add `*temporal-env` to docker-compose `registry`/`data`; add
   `TEMPORAL_ADDRESS` to dagger `registryService()`/`dataService()`.
5. **Build**: `componentsjs-generator` picks up the new class (run the normal
   build).
6. **Verify**: dev — PUT an activity, kill/stop the auth server briefly during
   delivery, confirm the workflow retries and delivers once auth is back; the
   dagger suite stays green (delivery now via Temporal in the test stack).
7. **Main plan**: point §4.3 (Phase 4.3) at this document.

## 7. Out of scope / follow-ups

- Activity-side DPoP token regeneration (§5.1) — do when a receiver verifies
  sender identity.
- Per-channel strict ordering (§5.4) — only if out-of-order becomes a problem.
- Unsubscribing dead channels (`TODO: unsubscribe` in the handlers) — surfaced
  by the 4xx non-retryable path.
- The reconciliation sweep (Phase 4.2) remains the backstop for deliveries that
  exhaust their attempts.
