# Plans index

Status snapshot of the implementation plans in this directory, cross-checked
against the current codebase and git history. A plan's own `Status` header is the
primary source.

## Summary

| Status | Count | Plans |
|---|---|---|
| ✅ done | 16 | `cleanup-fetch-utils`, `depend-on-generic-auditing`, `immutable-activities`, `improve-jsonld-use`, `refactor-data-instance`, `refactor-data-model`, `refactor-data-model-followup`, `refactor-grants-workflows`, `refactor-ui`, `remove-access-authorization-indirection`, `remove-access-grant-indirection`, `simplify-authorization-containment`, `simplify-factories`, `simplify-grant-as-pojos`, `test-infra-consolidation`, `workflow-temporal-decupling` |
| 🔶 partial (first cut landed) | 1 | `revoke-delegation-chain` |
| ⬜ not started / design only | 5 | `authorization-revoked`, `check-equivalence`, `durable-webhook-delivery`, `remove-turtle-serialization`, `webhook-subscription-bootstrap` |
| ⬜ follow-up backlog (all items open) | 1 | `revoke-delegation-chain-follow-ups` |

**23 plans total.** All remaining work lives in the 6 non-done plans below —
nothing open is blocked by an unlanded plan.

## Full table

| Plan | Status | What it does | Depends on |
|---|---|---|---|
| `simplify-grant-as-pojos.md` | ✅ done (historical) | Grants as `GrantData` POJOs (read/write via JSON-LD round-trip, scope-based dispatch) | — (foundation of the POJO migration) |
| `remove-access-grant-indirection.md` | ✅ done | Drops the `AccessGrant` wrapper: `AgentRegistration` links `hasDataGrant` directly | `simplify-grant-as-pojos` (the pattern it mirrors) |
| `remove-access-authorization-indirection.md` | ✅ done | Drops the `AccessAuthorization` wrapper: registry links `DataAuthorization` directly; extracts `jsonld-utils` | `remove-access-grant-indirection` (its mirror) |
| `simplify-authorization-containment.md` | ✅ done¹ | Authorization registry containment via server-managed `ldp:contains`; deny/revoke physically DELETEs resources | `remove-access-authorization-indirection` |
| `refactor-data-model.md` | ✅ done² | POJO migration of the remaining data-model classes (Phases 1–4 done; Phase 5 continued in the follow-up; Phase 6 → `test-infra-consolidation`) | `simplify-grant-as-pojos`, `remove-access-authorization-indirection` (prior migrations) |
| `refactor-data-model-followup.md` | ✅ done | CRUD domain resources as framed JSON-LD POJOs (GET/PUT raw JSON-LD; SPARQL stays for PATCH modules); Phase 4 (DataInstance) extracted | `refactor-data-model` |
| `refactor-data-instance.md` | ✅ done | DataInstance read path as framed JSON-LD; write-side class removed (blob work is the app's job) | `refactor-data-model-followup` (its Phase 4) |
| `simplify-factories.md` | ✅ done | `ApplicationFactory` becomes the base; `readable`/`crud`/`immutable` namespaces flattened to top-level methods | the POJO conversion (factories are structure-creating only once classes are gone) |
| `improve-jsonld-use.md` | ✅ done | Single shared `dataModelContext`; JSON-LD wire bodies in expanded form; `linkedIrisJsonLd` consolidation; POJO `label`→`prefLabel` renames | `refactor-data-model-followup`, `remove-access-authorization-indirection` (jsonld-utils / framing infra) |
| `cleanup-fetch-utils.md` | ✅ done | Deletes `fetch.ts`/`RdfFetch`; only `WhatwgFetch` remains; generic JSON-LD helpers moved data-model → utils | `improve-jsonld-use` (expanded-form writes), `refactor-data-model-followup` (`fetchJsonLd` pattern) |
| `test-infra-consolidation.md` | ✅ done | Root `test/` becomes the server-backed suite; `css-test-utils` + in-process CSS + `localhost:3711` realm removed; `registry.trig` is the single fixture | `refactor-data-model` (Phase 6 extraction; independent workstream) |
| `depend-on-generic-auditing.md` | ✅ done³ | Removes `setTimestampsAndAgents` and the `creator` param from all container creates (dead writes; metadata left to a future generic auditing mechanism) | — (independent cleanup) |
| `refactor-grants-workflows.md` | ✅ done⁴ | Self-contained `createGrantsForAgent` (full regeneration), typed `*Id` boundary objects, `checkEquivalence` dummy, removal of `updateGrantsForOneAgent`/`ensurePeers` | `simplify-authorization-containment` (extend-quirk context), the refactored workflow set |
| `workflow-temporal-decupling.md` | ✅ done⁵ | Activity Registry as the outbox: single-PATCH registration update, pre-seeded webhook channels + handler, per-target consumer, reconciliation sweep, real CSS delivery (Phases 0–2, 4.1–4.2, 5) | `refactor-grants-workflows` (the workflow set it decouples) |
| `immutable-activities.md` | ✅ done⁶ | Activity Registry becomes append-only; `done` = minimal `activityCompleted` completion activity; `updateActivityStatus` deleted | `workflow-temporal-decupling` (channel infra) |
| `refactor-ui.md` | ✅ done⁷ | `/.sai/events` NDJSON stream: `ActivityEvents` bus, `EventsHandler`, `events.ts` client, completion-driven + reconnect store refresh | `immutable-activities` (its stated prerequisite) |
| `revoke-delegation-chain.md` | 🔶 partial — first cut (steps 1–5) landed | Revocation as a boundary operation at the delegation endpoint (`AccessRevocation`, all-or-nothing validation, requester hop, `RevokeGrants` RPC); replaces direct cross-peer DELETE | `refactor-grants-workflows` (delegation model + the 403 that motivated it); references `authorization-revoked` (deny-RPC precedent) |
| `authorization-revoked.md` | ⬜ not done (design only) | Producer writes the typed `authorizationRevoked` activity for deny; routing/consumer/sweep already handle the type | `workflow-temporal-decupling` (Phase 4.4 extraction); `refactor-grants-workflows` (deny path) |
| `check-equivalence.md` | ⬜ not done (design only) | Real `checkEquivalence`: reuse equivalent existing grants (incl. child trees); workflow already fully wired | `refactor-grants-workflows` (whose shipped dummy it replaces; its "future step"), `workflow-temporal-decupling` (Phase 4.5) |
| `durable-webhook-delivery.md` | ⬜ not done (design only) | `DurableWebhookEmitter` enqueues a `deliverWebhook` Temporal workflow (bounded retries, 4xx non-retryable) on registry/data servers | `workflow-temporal-decupling` (Phase 4.3 extraction); `forward-to-push` worker |
| `webhook-subscription-bootstrap.md` | ⬜ not done (design only) | `ensureActivityWebhookChannel` at account creation + startup/periodic healing for real deployments (dev/test are pre-seeded) | `workflow-temporal-decupling` (Phase 3 extraction; builds on the landed ActivityRegistry module + `ActivityWebhookStore`/handler) |
| `remove-turtle-serialization.md` | ⬜ not started (no phase landed) | Drops `parseTurtle`/`serializeTurtle`: `toNQuads` for SPARQL patches, template-direct ACR write, NDJSON notification streams (custom CSS emitter) | `improve-jsonld-use` (`dataModelContext`), `refactor-data-model-followup`/`cleanup-fetch-utils` (`fetchJsonLd`/`putJsonLd` infra), external `@elfpavlik/sai-components` |
| `revoke-delegation-chain-follow-ups.md` | ⬜ all 9 items open | Items 1–9 of the revocation follow-up: full chain calculation, scope/mode-coverage ordering, replace-vs-delete race, grantor trigger integration (`grantsRevoked` producer), grantee self-revocation, error-detail schema, drop vestigial `delegationOfGrant`, sweep validation, `reconcileActivities` scheduling | `revoke-delegation-chain` (first cut) |

## Dependency graph

Three lineage arcs (plus one standalone plan). Read `→` as "depends on / builds on".

### A. Data-model POJO / JSON-LD refactor — all done

```
simplify-grant-as-pojos
  → remove-access-grant-indirection
      → remove-access-authorization-indirection      (extracts jsonld-utils)
          → simplify-authorization-containment       (ldp:contains)

refactor-data-model ──→ refactor-data-model-followup ──→ refactor-data-instance
        └─ Phase 6 → test-infra-consolidation (independent workstream)

    both chains converge on the POJO + JSON-LD read/write infra:
refactor-data-model / followup ──→ improve-jsonld-use ──→ cleanup-fetch-utils
simplify-factories                      (needs the POJO conversion done)
depend-on-generic-auditing              (independent adjacent cleanup)
remove-turtle-serialization ⬜          (sits on top of this infra; not started)
```

### B. Grant workflows & the activity outbox

```
refactor-grants-workflows  ✅
  ├─ workflow-temporal-decupling ✅ (Phases 0–2, 4.1–4.2)
  │    ├─ webhook-subscription-bootstrap ⬜ (Phase 3)
  │    ├─ durable-webhook-delivery       ⬜ (Phase 4.3)
  │    ├─ authorization-revoked          ⬜ (Phase 4.4)
  │    └─ check-equivalence              ⬜ (Phase 4.5)
  ├─ check-equivalence ⬜                        (the plan's own "future step")
  ├─ immutable-activities ✅ → refactor-ui ✅    (both landed)
  └─ revoke-delegation-chain 🔶 (403 → boundary revocation)
        └─ revoke-delegation-chain-follow-ups ⬜ (items 1–9)
```

### C. The open plans are for the most part independent work items

- `check-equivalence` — **unblocked**: `createGrantsForAgent` already consumes
  `reused`; only the activity needs a real implementation.
- `authorization-revoked` — **unblocked**: routing, per-target consumer and sweep
  already support the type; only `recordAuthorization` needs to write it.
- `durable-webhook-delivery` — **unblocked**: needs the emitter + workflow +
  `TEMPORAL_ADDRESS` on the registry/data services.
- `webhook-subscription-bootstrap` — **unblocked**: builds on the landed
  ActivityRegistry module + `ActivityWebhookStore`/handler; runtime-only
  (dev/test are pre-seeded).
- `revoke-delegation-chain-follow-ups` — depends only on the landed first cut;
  internal ordering: 1 (chain calc) → 2 (coverage ordering) → 4 (trigger
  integration); 3 (replace-vs-delete race) is orthogonal; 8 → 9 (sweep
  validation then scheduling). Items 3 & 4 would also re-enable the
  `refactor-grants-workflows` commented-out delete.
- `remove-turtle-serialization` — independent of the workflow/revocation arcs.

## Custom Community Solid Server (CSS) components

All three servers deploy this repo's custom Components.js components — published as
`@elfpavlik/sai-components` (the in-repo `packages/components`), compiled by
`componentsjs-generator` into `dist/components/*.jsonld`, wired via
`sai:config/<server>.json` → `sai:config/http/handler/default.json`, imported by
`environments/css/{auth,data,registry}.json`. CSS built-ins can be replaced with
`@type: Override` configs in `packages/components/config/overrides/` (existing
precedent: `jwks.json`, `disable-ui.json`). Two flavours of plans exist:

### Override CSS's built-in components (only these two, both on the registry + data servers)

The **auth** server imports `css:config/http/notifications/disabled.json` — no emitter
anywhere near it. The two servers with notifications enabled (`css:config/http/notifications/all.json`)
are **registry** (`config/registry.json`) and **data** (`config/data.json`). Both plans
below replace a stock CSS notification pipeline piece on those two servers:

| Plan | CSS built-in replaced | Notes |
|---|---|---|
| `durable-webhook-delivery.md` ⬜ | `urn:solid-server:default:WebhookEmitter` → `DurableWebhookEmitter` (extends it; starts a `deliverWebhook` Temporal workflow with bounded retry instead of fire-and-forget POST) | New `config/overrides/emitter.json` mirroring the `jwks.json` override pattern, imported by `registry.json` + `data.json`; class exported from `packages/components` index for the generator |
| `remove-turtle-serialization.md` ⬜ (Phase 3) | Streaming-HTTP notification internals → custom NDJSON emitter stack (`accept: application/x-ndjson`, expanded JSON-LD + `\n` per notification): replaces `StreamingHttp2023Emitter`, `BaseNotificationSerializer`, `StreamingHttp2023RequestHandler`, `StreamingHttpListeningActivityHandler` (or a full streaming-http override) | Lives in `packages/components` (the plan's `@elfpavlik/sai-components`); only the streaming channel — webhook delivery above is separate; optional content negotiation keeps Turtle consumers working |

These are adjacent (same notification area, same servers, same override mechanism) but
independent. They are the **only** plans that rewrite CSS internals.

### Extend the CSS config with custom "sai" components (already shipped; not overrides)

| Plan | Custom components added |
|---|---|
| `workflow-temporal-decupling.md` ✅ | `ActivityWebhookHandler` + `ActivityWebhookStore` (auth server); delivery itself stays the **stock** CSS `WebhookChannel2023` emitter with pre-seeded kv channels |
| `refactor-ui.md` ✅ | `ActivityEvents` bus + `EventsHandler` (`GET /.sai/events`) on the auth server |
| `revoke-delegation-chain.md` 🔶 | `GrantRevocationHandler` + `AccessRevocation` dispatch on the delegation endpoint (`GrantIssuanceRouter`), and the `RevokeGrants` RPC (`services/Revocation.ts` via `ApiHandler`) |
| `webhook-subscription-bootstrap.md` ⬜ | Reuses the existing `ActivityWebhookStore` + the **stock** CSS notification API (`SubscriptionClient` → `WebhookChannel2023`, kv-backed `KeyValueChannelStorage`) — no new components |

`immutable-activities.md` (✅) changes the *behavior* of the existing
`ActivityWebhookHandler` (completions) — no new component.

### No CSS components needed

Everything else — the data-model POJO/JSON-LD refactors (`simplify-grant-as-pojos` …
`cleanup-fetch-utils`, `improve-jsonld-use`, `test-infra-consolidation`, …),
`authorization-revoked`, `check-equivalence`, `refactor-grants-workflows`,
`revoke-delegation-chain-follow-ups` — runs in the Temporal worker, the services layer,
or data-model; they neither override nor extend the CSS server configuration.

## Known leftovers carried inside "done" plans

¹ `simplify-authorization-containment.md` — `packages/authorization-agent/test/authorization-agent.test.ts`
remains `describe.skip`-gated (pre-existing deferral also noted in §13 of
`remove-access-authorization-indirection.md`); the test-utils mock has no DELETE
support.
² `refactor-data-model.md` — the "Phase 5 (reworked) in progress" note is gone:
Phase 5's continuation (CRUD modules as POJO GET/PUT) landed in
`refactor-data-model-followup.md`, and Phase 6 in `test-infra-consolidation.md`.
³ `depend-on-generic-auditing.md` — had no status marker; commit
`ddc80e23 depend on generic audit mechanism` confirms the removal.
⁴ `refactor-grants-workflows.md` — the HTTP-DELETE of old grant resources in
`createGrantsForAgent` is still commented out (CSS 403 on grantor-side DELETE of
delegated grants); the revocation-boundary design (`revoke-delegation-chain.md`)
is the resolution vehicle, whose remaining pieces are tracked in its follow-ups.
⁵ `workflow-temporal-decupling.md` — Phases 3, 4.3, 4.4, 4.5 are tracked in the
standalone (still open) plans listed above; the docs pass (Phase 5) is done.
⁶ `immutable-activities.md` — doc header said "planned"; implementation landed in
commit `ee2b366c immutable activities` (confirmed with the user).
⁷ `refactor-ui.md` — doc header said "planned"; implementation landed in commit
`240bb321 [ui] refactor` (confirmed with the user).

