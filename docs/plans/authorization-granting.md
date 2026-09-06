# Authorization granting — `recordAuthorization` + `shareResource` (+ access request)

> **Status: design only — extracted out of `activity-first-services.md`
> steps 7–8 (2026-09), then joined by the access-request leg (`requestAccess
> UsingApplicationNeeds`, formerly its step 10 — matching the revocation
> plan's extraction).** The two main moves ride **structure types**
> (`AuthorizationStructure`, `DataAuthorizationStructure`,
> `ShareDataInstanceStructure`) whose fields have NO `dataModelContext` terms
> — the term-gap (execution note 9 in `payload-contract-alignment.md`) is why
> the POJO-first reorder moved them to the end, and why they now live here as
> one plan: the **granting leg**, counterpart of
> [`authorization-revocation.md`](authorization-revocation.md). The access-
> request leg has NO structure types (plain-IRI `webId`/`applicationId`) — it
> rides along as the plan's third scope row.

## 1. Scope — the granting leg

The activity-first moves for the two granting RPCs (was steps 7–8 of
`activity-first-services.md`):

| RPC | activity class(es) | Structure types in play |
|---|---|---|
| `recordAuthorization` (`AuthorizeApp`) | `authorizationRecorded` (+ the `Revoked` carrier for the deny path — cross-ref the revocation plan) | `AuthorizationStructure` / `DataAuthorizationStructure` |
| `shareResource` | `authorizationRecorded` (one per deduped grantee) | `ShareDataInstanceStructure` / `DataAuthorizationStructure` + `applicationId` |
| `requestAccessUsingApplicationNeeds` (access request) | a NEW class (e.g. `AccessNeedGroupRequested`) — flat `{ webId, applicationId }` | **none** (plain IRIs — the term-gap does not apply; the access-need-group is derived in the workflow from the client-id document) |

**Access-request leg** (moved from `activity-first-services.md` step 10): the
RPC keeps the guard read (registration exists) + writes the activity with flat
plain-IRI fields; a minimal workflow loads the client-id document and performs
the single `setAccessNeedGroup` PATCH as `getSession(ctx.webId)`, then
completes (idempotent — a retry re-PATCHes the same group, a no-op). The ack
echoes the agent webId + `activityId`; the `accessRequested` profile flag
refreshes via the done-row.

Both follow the established template (the `InvitationCreated` form): the RPC
**pre-mints** the DataAuthorization id(s) (`iriForContained`) and writes the
activity whose `as:object` is the **real-id embedded projection** of the
DataAuthorization-to-be (`target` removed — nothing consumes it; the id rides
`object.id`); the workflow records the authorizations at those ids
(`recordAuthorizationFromStructure` / `shareDataInstance` as
`getSession(ctx.webId)`) → the per-grantee consumer regenerates → completion;
the RPC returns a pending ack (+ `activityId`).

The org-session workflow also fixes the **shareResource org-context debt**
(`shareDataInstance` writing on the session's *own* registry set today).

## 2. The blocker — the structure term-gap (settle FIRST)

Execution note 9 (`payload-contract-alignment.md`): the structure fields
(`agentType`, `granted`, `accessNeed`, `scopeOfAuthorization`, `applicationId`,
`resource`, `children`, `agents`, …) have NO `dataModelContext` terms — JSON-LD
expansion **silently drops unknown keys on write** (observed on the deny
snapshot: `agentType`/`granted` vanished; the snapshot was trimmed to
term-covered fields). Any structure-on-the-wire form — the real-id embedded
projection of the DataAuthorization-to-be, or the flat `authorization`-carrier
follow-up (`AuthorizationRequested`/`ShareRequested`, `payload-contract-alignment.md`
§5) — therefore requires one of:

1. a **dedicated structure field vocabulary/context** (the plan's candidate #1),
2. **expanded-form writes** with full-IRI keys, or
3. the **link-to-stored-description** candidate.

**Decision A: pick the carrier + the vocab approach before hardening any
shapes** (this is the reorder's original justification).

## 3. What lands here (the `activity-first-services` carry-over)

- **The `AuthorizationRecorded` / `AuthorizationRevoked` carrier re-pins**
  (contract snapshot): `target` dropped; the DataAuthorization-to-be /
  -to-revoke as real-id embedded projections at the pre-minted / existing ids.
  The `Revoked` side feeds `authorization-revocation.md` (its consumer
  derives the grant revocation); the deny path (`granted: false`) writes the
  typed `authorizationRevoked` per `authorization-revoked.md`.
- **The per-grantee consumer choice** (was open decision 1): dedicated
  per-activity workflow vs extending the coalescing per-grantee consumer
  (which today reads authorizations from the registry — with the payloads
  riding the activity, the consumer can read `grantee` from the object).
- **Handler + reconcile branches** (the `GRANTEE_ACTIVITY_TYPES` drain
  already routes both classes), **docs/c4 views** (`authorization`,
  `share-resource`, `share-resource-get-data`), **UI** (claim + done-rows),
  **seeds** (kv.json channels for new orgs — yoyo/dan pre-seeded), and the
  **`/test` parity suites** (authorization/share become wait-for; end-state
  identical to today).

## 4. Open decisions

1. **Dedicated workflow vs extended per-grantee consumer** (section 3).
2. **The carrier + vocabulary** (Decision A) — the term-gap resolution.
3. **Deny-path home**: the `Revoked` producer (this plan) vs the revocation
   plan's UI leg — the deny-via-`AuthorizeApp` (`granted: false`) shares the
   same RPC; coordinate so the deny path writes `authorizationRevoked` exactly
   once.

## 5. Out of scope here

- The **revocation side** (`authorization-revocation.md`): UI revoke →
  `authorizationRevoked` → workflow revokes grants.
- The **verify-only keepers** (`createRole`,
  `requestAccessUsingApplicationNeeds`) and the **housekeeping**
  (`addSocialAgent`) stay in `activity-first-services.md` (steps 9–10).
- The flat `AuthorizationRequested` / `ShareRequested` classes
  (`payload-contract-alignment.md` §5 follow-up) — **this plan RESOLVES their
  fate**: **use** (Decision A picks the flat carrier → complete their routing —
  today they are unroutable stubs: no `loadActivity` cases, no
  handler/reconcile rows, no producers) **or drop** (remove the types, union
  members, context/namespaces terms + api-messages projections). The decision
  is recorded when the carrier is settled (section 2).