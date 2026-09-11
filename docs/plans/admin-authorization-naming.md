# Admin authorization naming — `AdminAuthorizationGranted`

> **Status: ✅ DONE (implemented + packages/UI verified; `/test` admin-events
> re-run pending: user).** Pure naming alignment — no behavior change.
> Aligns the org-admin activity pair with the authorization terminology
> decided in `authorization-granting.md` §1.

## 1. Decision

`AdminAuthorizationRecorded` → **`AdminAuthorizationGranted`**;
`AdminAuthorizationRevoked` is unchanged.

Rationale: an `AdminAuthorization` is an authorization; the admin marker is
**granted** and **revoked**. `Recorded` is the lone system-verb outlier in the
authorization family and reads as ambiguous next to `Granted`/`Denied`/
`Revoked`. All three authorization classes then use actor verbs:
`AuthorizationGranted` / `AuthorizationDenied` / `AuthorizationRevoked` and
`AdminAuthorizationGranted` / `AdminAuthorizationRevoked`.

Admin has **no deny path** (it is a toggle), so only the positive half is
renamed.

## 2. Surface (complete touch list — source only)

Rename the activity class + its RDF term + the RPC message. Keep
`AdminAuthorizationRevoked` untouched.

| Layer | File | What changes |
|---|---|---|
| vocab | `packages/utils/src/namespaces.ts` | `'AdminAuthorizationRecorded'` → `'AdminAuthorizationGranted'` (INTEROP term) |
| data-model | `packages/data-model/src/activities.ts` | type `AdminAuthorizationRecorded` + `AdminAuthorizationRecordedId` + `ActivityData` union member |
| data-model | `packages/data-model/src/context.ts` | context row `AdminAuthorizationRecorded` → `AdminAuthorizationGranted` |
| data-model | `packages/authorization-agent/src/activity-registry.ts` | the `case 'AdminAuthorizationRecorded'` decode branch (lines ~248–255) |
| rpc | `packages/api-messages/src/effect.ts` | activity projection `AdminAuthorizationRecorded` → `…Granted`; RPC ack `AdminAuthorizationRecordedMessage` → `…GrantedMessage` |
| components | `packages/components/src/services/Admin.ts` | `addAdmin` activity `type: ['Activity', 'AdminAuthorizationGranted']`; ack construction |
| components | `packages/components/src/ActivityWebhookHandler.ts` | dispatch `isActivityClass(activity, 'AdminAuthorizationGranted')` + `S.decodeUnknownSync` |
| components | `packages/components/src/temporal/activities/grants.ts` | `resolveActivityAdmin` branch (`isActivityClass(…, 'AdminAuthorizationGranted')`) |
| components | `packages/components/src/temporal/workflows/grants.ts` | `reconcileActivities` branch |
| components | `packages/components/src/temporal/workflows/admin.ts` | input ref type `AdminAuthorizationRecordedId` → `…GrantedId` |
| UI | `ui/authorization/src/activityLabels.ts` | label key |
| UI | `ui/authorization/src/events.ts` | `type.includes('AdminAuthorizationRecorded')` → `…Granted` |
| UI | `ui/authorization/src/store/app.ts` | the toggle-admin claim `type: 'AdminAuthorizationRecorded'` → `…Granted` |
| tests | `packages/data-model/test/activities.test.ts`, `packages/utils/test/namespaces.test.ts`, `test/admin-events.test.ts` | assertions |
| docs | `docs/plans/events.md`, `docs/features.md`, `docs/temporal.c4` (`org-admin-add`), `docs/plans/activity-first-services.md`, `docs/plans/payload-contract-alignment.md`, `docs/plans/authorization-granting.md` | terminology |

## 3. Steps (each independently verifiable)

**Step 1 — vocab + data-model types (no behavior).**
`namespaces.ts`, `activities.ts`, `context.ts`, `activity-registry.ts`.
**Verify:** `packages` build + data-model/utils vitest green; no runtime path
uses the class yet (only the type/term changed).

**Step 2 — api-messages + components producers/handler.**
`effect.ts` projections + Message; `services/Admin.ts`; dispatch; reconcile;
workflow ref types.
**Verify:** `packages` build + components vitest green; `Admin.ts` unit test
asserts the new class; handler/reconcile branch tests updated.

**Step 3 — UI labels/claims + docs/c4.**
**Verify:** `ui/authorization` `vue-tsc --noEmit`; `likec4 validate` clean;
`test/admin-events.test.ts` (user-run) green.

## 4. Decision (made) — RDF-term back-compat

**Accepted the dev-only break (option a — the codebase stays clean, no alias).**
Existing Activity Registry resources typed `interop:AdminAuthorizationRecorded`
(dev seeds / in-flight runs) no longer decode; the in-repo seeds and the
`/test` envs are regenerated per run, so nothing stale survives. The decoder
handles only `AdminAuthorizationGranted`; a decode alias was deliberately NOT
added.

## 5. Out of scope

- The **data-granting** terminology (`AuthorizationGranted` etc.) —
  [`authorization-granting.md`](authorization-granting.md).
- Any behavior change to the admin toggle / last-admin guard.
