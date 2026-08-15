# Immutable activity registry — append-only log with minimal completion records

> **Status:** planned. Turns the Activity Registry into an append-only log:
> activity resources are **never mutated**; a workflow completing an activity
> **PUTs a minimal completion activity** (`activityType: 'activityCompleted'`,
> `target` = the completed activity's IRI — the existing `target` field, no new
> vocabulary, no payload) instead of PATCHing `status`. The container webhook
> channel then delivers **both** the change `Add` and the completion `Add`.
> **Pre-requisite for [`refactor-ui.md`](refactor-ui.md)**: the `/.sai/events`
> stream relies on the container channel as its only signal source.

---

## 1. Motivation

`refactor-ui.md` wants the pre-seeded container webhook channel to be the single
source of events for the UI. Today that's impossible for the `done` signal:
completion is a status PATCH on the activity **resource**, which emits `Update`
on the activity's **own** channel — invisible to the container subscription
(container subscriptions deliver `Add`/`Remove`/`Update`(container), not member
`Update`s; §3.4 of `workflow-temporal-decupling.md`). The workaround
(per-activity webhook subscriptions, one per pending activity) adds churn and
failure modes.

Making activities immutable and completing via a **new activity in the same
container** turns `done` into a container `Add` — visible on the existing
pre-seeded channel with **zero new subscriptions**. This plan converts the
registry; `refactor-ui.md` then consumes the result.

## 2. New model

- **Change activities** (producers) are immutable: PUT
  `{ activityType, target, payload, createdAt }` — **no `status`**.
- **Completion** = a new activity in the same container, written by whoever
  currently marks done:

  ```jsonld
  {
    "id": "<registry>/activity/<uuid>",
    "type": ["interop:Activity"],
    "activityType": "activityCompleted",
    "target": "<registry>/activity/<completed-uuid>",
    "createdAt": "<ISO 8601>"
  }
  ```

  Minimal on purpose: only `activityType` + `target` (the completed activity
  IRI) + `createdAt`. `target` is an existing `ActivityData` field, already in
  `dataModelContext` (`packages/data-model/src/context.ts:89`) → **no
  vocabulary or context change**. No `payload`.
- **Pending** = a change activity (`activityType !== 'activityCompleted'`) with
  **no completion referencing it** (no `activityCompleted` whose `target` = its
  IRI). Completions are terminal — never referenced by other completions, never
  pending.
- The container webhook delivers `Add` for change activities **and** for
  completions — one channel, both signals.

## 3. Changes

| Area | Change |
|---|---|
| `packages/data-model/src/crud/activity-registry.ts` | `ActivityData`: drop `status` (keep `target`); `createActivity` input drops `status`; `loadActivity` drops `status`; **delete `updateActivityStatus`**; add `createCompletion(registry, factory, completedIri)` and a pending helper (`getCompletedActivityIris` = `target`s of all `activityCompleted` activities) |
| `packages/data-model/src/context.ts` | remove the `status` mapping (`:91`) — `target` already present |
| Producers — `services/Authorization.ts`, `services/RoleRegistry.ts` (×2), `services/ShareResource.ts`, `InvitationHandler.ts` | drop `status: 'pending'` from `createActivity` (one line each) |
| `packages/components/src/temporal/activities/grants.ts` | `getPendingGranteeActivities` / `getPendingActivities` (`:506–552`): filter "not completed" instead of `status === 'pending'` — one pass over `getActivityIris` + `loadActivity`, partition completions into a completed-set, pending = typed work items ∉ set (same cost as today: every activity is already loaded); `markActivitiesDone` (`:560`): replace `updateActivityStatus` PATCH with `createCompletion` per activity — **signature/name unchanged** |
| `packages/components/src/temporal/workflows/grants.ts` | **no logic change** — `processGranteeActivities`, `processRoleMembershipChange`, `processRoleDeletion`, `reconcileActivities` all keep calling `markActivitiesDone`; "pending" is now implicitly "not completed"; completions never enter the work set → no loop |
| `packages/components/src/ActivityWebhookHandler.ts` | no correctness change: `activityCompleted` is not in the routing map and not a grantee type → falls through (200) today. Events-side handling (enrichment) belongs to `refactor-ui.md` |
| `test/reconciliation.test.ts` | drop `status: 'pending'` from `createActivity`; replace the `status === 'done'` assertions with "a completion referencing `activity.id` exists" (small `getCompletedActivityIris`/`hasCompletion` helper) |
| Seeds / env (`kv.json`, `registry.trig`) | **none** — no seeded activities; the container webhook pre-seed (one channel per account) is unchanged |
| Docs | consistency pass on `workflow-temporal-decupling.md` (§3.1 example, §4.2 "mark their activity done via `activityIri`" — still true, via completion, §6.11 "marks entries done (PATCH status) or removes them", Phase 4.2 "pending → sweep → done") |

## 4. Design decisions

1. **Random completion IRI; duplicate completions accepted (for now)** —
   `createCompletion` uses the existing random `iriForContained`, same as any
   other activity. Concurrent completers (per-target consumer + sweep) may both
   PUT a completion for the same activity, producing duplicates. Accepted: the
   pending-helper partitions by `target`, so duplicates only mean the completed
   activity's IRI appears in the completed-set more than once — no functional
   impact. (Future dedupe option: deterministic IRI derived from the completed
   activity IRI + `If-None-Match: *`, swallow 412.)
2. **Completion carries no payload.** The events stream (`refactor-ui.md`)
   enriches server-side: when the webhook handler sees an `activityCompleted`
   `Add`, it loads the completed activity (its `activityType`/`payload`) and
   forwards a rich `done` event to the UI. The resource itself stays minimal.
3. **Completions are terminal** — excluded from pending by type; nothing
   completes a completion.
4. **GC (future, out of scope)** — optionally DELETE completed activities +
   completions to bound the log (emits container `Remove`; the handler ignores
   it; events replay is unaffected).
5. **"done" is observable only as a container `Add`** — activity resources are
   silent after creation (immutable). This is exactly the property
   `refactor-ui.md` relies on; any future consumer of per-activity `Update`s
   must switch to completions.

## 5. Phases — green suite after every phase

**Phase 0 — append-only conversion.**

- data-model: `ActivityData`/`createActivity`/`loadActivity` drop `status`;
  delete `updateActivityStatus`; add `createCompletion` + pending helpers.
- Producers drop `status: 'pending'`.
- `activities/grants.ts`: swap `getPending*` filters and `markActivitiesDone`
  implementation (workflows untouched).
- `test/reconciliation.test.ts` reworked to assert completion existence.
- **Gate:** `pnpm test` + `pnpm typecheck` green.

**Phase 1 — sweep + docs alignment.**

- `reconcileActivities` doc comment; consistency pass on
  `workflow-temporal-decupling.md` (workflow code unchanged).
- **Gate:** green.

`refactor-ui.md` builds on top: its Phase 0 ("mark every activity done") becomes
"every workflow creates a completion" (including `agentRegistrationAdded` and
the new `delegatedGrantsUpdated`), and its event stream consumes the completion
`Add`s from the container channel — no per-activity subscriptions.
