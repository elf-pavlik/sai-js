# Authorization granting — `AuthorizationGranted` (+ `AuthorizationDenied`, requests, share)

> **Status: design only for the parts below.** The **request leg**
> (`NeedBasedAccessRequest` → `AccessRequestRegistry` → approval) already
> landed (see `docs/features.md`); this plan covers the **terminology
> alignment**, the **activity-first granting leg**, the **`shareResource`
> unification**, **specific-instance requests**, and the **deny/revoke
> split**. Extracted from `activity-first-services.md` steps 7–8, then
> re-scoped (2026-09) around the decisions in §1.
>
> **Sibling plans:** [`authorization-revocation.md`](authorization-revocation.md)
> (the revoke action + grant revocation) ·
> [`authorization-revoked.md`](authorization-revoked.md) (typed revocation) ·
> [`admin-authorization-naming.md`](admin-authorization-naming.md) (the admin
> pair alignment) · [`payload-contract-alignment.md`](payload-contract-alignment.md)
> (the structure term-gap, execution note 9) ·
> [`revoke-delegation-chain.md`](revoke-delegation-chain.md) (delegation
> boundary).

## 1. Terminology (DECIDED — authoritative)

> **Principle: verbs belong to their subject.** You *deny/approve a*
> **request**. You *grant/revoke an* **authorization**. "Recorded" is a
> system/logging verb that says nothing about the outcome — fine for storage,
> wrong as the domain discriminant.

| Concept | Subject | Class | Change |
|---|---|---|---|
| requester asks | request | `NeedBasedAccessRequestSent` / `NeedBasedAccessRequestReceived` | unchanged (landed) |
| owner declines | request/decision | **`AuthorizationDenied`** | **new** |
| owner approves | authorization | **`AuthorizationGranted`** | **rename of `AuthorizationRecorded`** (positive only) |
| owner/system withdraws | authorization | `AuthorizationRevoked` | keep (producer pending) |
| grant intent carrier | — | ~~`AuthorizationRequested`~~ | **drop** (redundant — the grant carrier *is* `AuthorizationGranted`) |
| owner direct share | authorization | ~~`ShareRequested`~~ | **drop** — reuses `AuthorizationGranted` (§5) |

Why `AuthorizationGranted` is preferred over `AuthorizationRecorded`:

- `interop:DataAuthorization` is **inherently a positive grant** — a "denied
  authorization" is a domain contradiction. `AuthorizationRecorded` currently
  carries *both* outcomes, hiding the outcome in the object shape (link-set vs
  snapshot); the plan's own `authorization-revoked.md` calls this
  "semantically wrong".
- The RPC already speaks this vocabulary: `effect.ts` defines
  `GrantedAuthorization | DeniedAuthorization`. The activities **match the RPC
  union** after the rename.
- `Granted`/`Denied`/`Revoked` are all actor decisions; `Recorded`/`Revoked`
  mixed a system verb with a domain verb.

The request axis keeps `NeedBasedAccessRequest*` (the `NeedBasedAccessRequest`
**data type** is distinct from the delegation `AccessRequest` /
`AccessRevocation` types). Dropping the `NeedBased` prefix from the *activity*
names is a possible later alignment — **open decision (§11), not this plan.**

## 2. Target activity set & carriers

| Activity | Producer | Object carrier |
|---|---|---|
| `NeedBasedAccessRequestSent` | requester RPC / endpoint (landed) | urn:uuid snapshot (requester has no registry to mint in) |
| `NeedBasedAccessRequestReceived` | owner endpoint (landed) | real-id embedded `NeedBasedAccessRequest` at the minted id |
| `AuthorizationGranted` | granting RPC / share RPC | **`DataAuthorizationData` POJO(s)-to-be, real-id embedded at pre-minted id(s)** |
| `AuthorizationDenied` | granting RPC (`granted:false`) | `EmbeddedAuthorization` snapshot (term-covered subset) |
| `AuthorizationRevoked` | revoke RPC (sibling plan) | the DataAuthorization(s) to withdraw |
| `ActivityCompleted` | workflows | — |

## 3. Current state (as-is)

- **Request leg — landed** (`authorization-granting.md` §6 of the previous
  revision): `NeedBasedAccessRequest` + `AccessRequestRegistry` +
  `GrantIssuanceHandler` branch + `processNeedBasedAccessRequest{,Received}` +
  the RPC leg + approval `getDescriptions({ accessRequestIri })`. Documented
  in `docs/features.md`.
- **Granting leg — synchronous.** `recordAuthorization` (`services/Authorization.ts`)
  and `shareResource` (`services/ShareResource.ts`) **write the
  DataAuthorizations synchronously** and then write `AuthorizationRecorded`
  (both outcomes) only to trigger the per-grantee grant consumer. Not
  activity-first.
- **`AuthorizationRequested` / `ShareRequested`** exist as types but are
  **unroutable stubs** (no producer, no `loadActivity` cases, no
  handler/reconcile rows).
- **Structure term-gap** (execution note 9): the RPC structure fields
  (`agentType`, `granted`, `applicationId`, `resource`, `children`, `agents`)
  have no `dataModelContext` terms → JSON-LD expansion silently drops them.

## 4. The granting leg — one activity, `DataAuthorizationData` carrier

### 4.1 The term-gap is settled by the carrier choice (Decision A)

Embed the **`DataAuthorizationData` POJO(s)** the workflow should materialize —
**not** the RPC `AuthorizationStructure` / `ShareDataInstanceStructure`.

`DataAuthorizationData` (`data-model/src/data-authorization.ts`) is **fully
term-covered**: `satisfiesAccessNeed`, `scopeOfAuthorization`,
`hasDataRegistration`, `hasDataInstance`, `accessMode`,
`inheritsFromAuthorization`, … So the RPC/workflow can pre-build the
DataAuthorizations-to-be and embed *those* at pre-minted ids. `agentType` /
`granted` never need to ride the wire; `applicationId` (share) is only used
for the RPC callback response, not stored. **No new structure vocabulary is
required** — Decision A resolves to "embed `DataAuthorizationData`; drop the
flat structure carriers".

`buildNestedDataAuthorizations(structure, accessNeedGroup, grantedBy)` (AA,
`authorization-agent/src/authorization.ts:92`) already returns the nested
DataAuthorization POJOs — the RPC reuses it, assigns pre-minted ids (parents +
inherited children), and embeds them.

### 4.2 Flow (the `createInvitation` template)

1. **RPC** — validation reads; pre-mint DataAuthorization id(s)
   (`iriForContained`); build the DataAuthorization POJO(s)-to-be; write
   `AuthorizationGranted` (object = the POJO(s), real-id embedded); return a
   pending ack + `activityId`.
2. **Handler** — dispatch `AuthorizationGranted` → a **dedicated granting
   workflow** (decided — [`architecture.md`](architecture.md) §4).
3. **Workflow** — `processAuthorizationGranted`: PUT the DataAuthorizations
   at the pre-minted ids (`getSession(ctx.webId)`, find-first/
   `If-None-Match` idempotent) → regenerate grants → single
   `ActivityCompleted`. (Regeneration shape: see §11.1.)
4. **UI** — pending indicator → `done` refresh (the uniform claim anchor).

This also fixes the **org-context debt**: the workflow runs with the org
session (`getSession(ctx.webId)`), not the admin's UAS.

## 5. `shareResource` unification (`ShareRequested` dropped)

`shareDataInstance` (`authorization-agent.ts:787`) already produces exactly
the carrier shape: `scopeOfAuthorization = SelectedFromRegistry` +
`hasDataInstance: [resource]` + `Inherited` children, one authorization per
grantee. So `shareResource` becomes:

1. RPC receives the share selection (`ShareDataInstanceStructure` stays an
   **RPC input** only — never stored on the wire);
2. builds the DataAuthorization POJO(s)-to-be (per deduped grantee, with
   minted ids) and writes **one `AuthorizationGranted` per grantee**
   (matching today's one-activity-per-grantee `shareResource`);
3. the same granting workflow materializes them; `applicationId` stays in the
   RPC for the callback endpoint only.

`ShareRequested` is **dropped** — owner-direct sharing is a `AuthorizationGranted`,
not a request.

> A **requester**-initiated "give me *this instance*" is a *request*, not a
> share — it rides the request axis (§6).

### 5.1 Single-activity share + per-grantee child fan-out (**✅ DONE**)

Decided 2026-09 (implemented): one share = **ONE `AuthorizationGranted` activity** (object =
**all grantees'** DataAuthorization-to-be POJOs — grantee rides every DA,
parents and children alike) → **one** webhook `Add` → **one** parent
`processAuthorizationGranted` → the parent **always fans out one child
`processGranteeAuthorization` per grantee** (materialize at the pre-minted
ids → regenerate) → **single completion at the parent** after ALL children
succeed (children never mark done).

- **Service thinness:** the per-grantee `createActivity` loop leaves
  `shareResource`; grouping moves into the workflow. Temporal owns retry /
  resume per child (find-first idempotent PUTs, full regeneration).
- **Always fan out** (single grantee included — uniform, no inline fast path).
- **Drop the legacy live-link `string[]` object form** (its last producer was
  pre-refinement share) — ✅ done: the handler, workflow, `reconcileActivities`
  and the decoder handle the embedded POJO form only; `test/reconciliation.test.ts`
  and the activity-registry fixtures moved to the embedded single-DA form.
  The deny snapshot form is gone too (Step 4): declines are `AuthorizationDenied`,
  and an empty/all-filtered grant writes `[]` (the child skips empty groups).
  and the decoder handle the embedded POJO form only; `test/reconciliation.test.ts`
  and the activity-registry fixtures moved to the embedded single-DA form.
  The deny snapshot form is gone too (Step 4): declines are `AuthorizationDenied`,
  and an empty/all-filtered grant writes `[]` (the child skips empty groups).
- `recordAuthorization` is unaffected (single grantee); reconcile passes the
  whole object — grouping happens inside the workflow.
- **c4:** the `share-resource` view merged `share-resource-get-data` into it
  (that view is removed); the fan-out is drawn as child workflows
  (`docs/temporal.c4` — validated).
- **Verification (done):** packages build 7/7; vitest green (components 40 —
  grouping + object-carried-grantee tests; authorization-agent 83 — embedded-form
  fixtures incl. the `AuthorizationDenied` snapshot round-trip). **`/test`
  re-run pending (user):** share, roles,
  authorization, reconciliation.

## 6. Specific-instance requests (`hasDataInstance` on `AccessNeed`)

Today `AccessNeedData` (`data-model/src/access-need.ts`) carries
`registeredShapeTree` / `accessMode` / `inheritsFromNeed` but **no instance
selection**. To support "I need *this* resource", add `hasDataInstance` to the
need:

- `data-model`: add the `hasDataInstance` term to the need context + `fromJsonLd`
  + the embedded round-trip (`accessNeedFromEmbedded` / `needToEmbedded` in
  `services/Authorization.ts` / `ShareResource.ts`).
- **Semantics:** the need's `hasDataInstance` is a **request hint** (what the
  requester wants). Approval still records the final
  `SelectedFromRegistry` + `hasDataInstance` via the authorization structure,
  so the owner can adjust. The approval screen prefills from the need.
- This gives the `ShareRequested` use case (request a specific instance)
  **without a new activity class** — it rides `NeedBasedAccessRequest*`, and
  the resulting grant rides `AuthorizationGranted`.

Vocabulary caveat: `hasDataInstance` currently lives on
`DataAuthorization`/`DataGrant`; on an `AccessNeed` it is an SAI-internal
overload (acceptable — the request group is already an SAI carrier, not a
spec-declared need). **Open decision §11.**

## 7. Deny vs revoke split (DECIDED — option 2)

**Decision: split the two actions.** `AuthorizeApp(granted:false)` today
*deletes* the grantee's DataAuthorizations (`replaceDataAuthorizationsForGrantee`)
— i.e. it behaves as a **revoke**. That conflates admission (deny) with
withdrawal (revoke).

| Action | When | Class | State change |
|---|---|---|---|
| **Decline** | a request (or a fresh decision), no prior grant | `AuthorizationDenied` | **none** (request stays immutable) |
| **Revoke** | an existing authorization is withdrawn | `AuthorizationRevoked` | delete the DataAuthorizations → grants regenerate to empty |

Consequences:

- `AuthorizeApp(granted:false)` becomes a **pure decline** (`AuthorizationDenied`,
  no delete). The delete behavior was **accidental** (the UI's `granted:false` is
  a *decline*, not a withdrawal). The old "grant → deny → grants cleared"
  test moves to the **revoke** test once the revocation plan lands.
- **Revoke is deferred (decision c, §9 Step 4):** no `AuthorizationRevoked`
  producer lands in this plan. The **revoke action/RPC + delete workflow** are
  the sibling plan [`authorization-revocation.md`](authorization-revocation.md)
  — its designated home; a temporary regression window is accepted until it
  lands (no UI withdrawal path: grants are cleared only via role-change
  workflows and the issuance endpoint `GrantRevocationHandler`).
- `AuthorizationDenied` is **forward-only** initially (no state change, no
  grant regeneration); requester notification is a follow-up.

## 8. Admin authorization naming (companion plan)

`AdminAuthorizationRecorded` / `AdminAuthorizationRevoked` shares the same
`Recorded`-vs-`Revoked` asymmetry. Since an `AdminAuthorization` is also an
authorization, align it to **`AdminAuthorizationGranted`** /
`AdminAuthorizationRevoked`. Captured separately (it is org-admin surface, not
the data-granting leg):
[`admin-authorization-naming.md`](admin-authorization-naming.md).

## 9. Steps — each independently verifiable

**Rules.** Every step leaves `packages` build + vitest green (agent-run) and
the relevant `/test` suites green (user-run, dagger). `docs/temporal.c4`
edits validate with `likec4 validate`. No step starts before its predecessor
is green.

**Layering.** Every step follows [`architecture.md`](architecture.md): thin
services/handlers (activity write only), workflow-orchestrated mutation, SAI
rules in `authorization-agent`. **Step 2 is the architecture pivot** — it
lands the dedicated-workflow shape first because steps 3–5 build on it;
it is one atomic, verifiable change (carrier + workflow + thin service +
handler + reconcile + tests).

**Step 0 — `docs/temporal.c4` gate (DECIDED by user before code).**
Update the views to the final names + split:
- `authorization` — `AuthorizationGranted` / `AuthorizationDenied`; the
  activity-first granting flow (pre-mint → activity → workflow PUTs →
  consumer); the revoke action drawn separately (or linked to
  `authorization-revocation.md`).
- `share-resource` — `AuthorizationGranted` (one per grantee), no
  `ShareRequested`.
- `request-access` — add the instance-selection detail (`hasDataInstance`
  on the need) and the deny branch (`AuthorizationDenied`).
- `authz-data-need-based-request` — approval prefills
  `SelectedFromRegistry` when the need names an instance.
- `org-admin-add` / `org-admin-remove` — `AdminAuthorizationGranted`
  (per §8; can land with the companion plan).
**Verify:** `likec4 validate --no-layout` on `docs/temporal.c4`; **user
sign-off on the flows + payloads**.

**Step 1 — vocabulary rename/drop (types only, no behavior).**
`data-model/src/activities.ts` + `context.ts` + `namespaces.ts` +
`api-messages`: rename `AuthorizationRecorded` → `AuthorizationGranted`; add
`AuthorizationDenied`; delete `AuthorizationRequested` and `ShareRequested`
(types, union members, context rows, namespace terms, api-messages
projections). Producers keep writing the renamed class for both outcomes —
**deliberate transient**; behavior is unchanged.
**Verify:** `packages` build + vitest green; the only test change is the
renamed class in assertions.

**Step 2 — activity-first granting via a dedicated workflow (ARCHITECTURE
PIVOT; one atomic change).**
- **Carrier:** RPC pre-mints the DataAuthorization id(s); builds the
  `DataAuthorizationData` POJO(s)-to-be (via AA `buildNestedDataAuthorizations`
  — the rule stays in `authorization-agent`); writes `AuthorizationGranted`
  (embedded object); returns pending ack + `activityId`; **no synchronous
  mutation** (the `recordAuthorizationFromStructure` call leaves the RPC).
- **Workflow:** new `processAuthorizationGranted(webId, dataAuthorizations,
  activity)` — materialize at the pre-minted ids (`getSession(ctx.webId)`,
  find-first/`If-None-Match`) → regenerate grants → single completion
  (see §11.1 for the regeneration shape). Bundled on `create-grants`;
  `reconcileActivities` branch.
- **Handler:** one dispatch branch (schema-decode + `workflow.start`),
  forward-before-dispatch unchanged.
- **Service thinning:** `recordAuthorization` keeps context gate + validation
  reads + `createActivity` only (the architecture roll-up, `architecture.md` §2).
**Verify (atomic — this step ships green on its own):** `packages` build +
vitest green; `test/authorization.test.ts` becomes **wait-for**; end-state
(DataAuthorizations + grants) identical to today's synchronous result;
retry/re-delivery idempotency check.
**TODO (architecture.md §7.4):** dedupe the embedded-node →
`DataAuthorizationData` normalization into data-model
(`authorization-agent/src/activity-registry.ts` `dataAuthorizationFromNode`
vs `data-model/src/data-authorization.ts` `compactNodeToDataAuthorizationData`).
**✅ DONE** (2026-09): `compactNodeToDataAuthorizationData` is exported + hardened
(same-doc embedded-node unwrap) in `data-model`; the activity decode reuses it.

**Step 3 — `shareResource` unification. ✅ DONE** (per-grantee activities are
being refined by §5.1 — single activity + child fan-out, **planned**, awaiting
review)
- `shareResource` builds the same `AuthorizationGranted` carrier from the
  share selection via a new AA build method (`AuthorizationAgent
  .buildShareDataAuthorizations` — owner-excluded + already-have-access
  filtered, ids pre-minted; the `shareDataInstance` write half is no longer
  called by the RPC); one `AuthorizationGranted` per deduped grantee with
  the EMBEDDED POJOs; `ShareDataInstanceStructure` never rides the wire
  (RPC input only).
- The same dedicated workflow materializes with the **org** session
  (`getSession(ctx.webId)`) — fixes the org-context share debt
  (`shareDataInstance` wrote against the session's registry set).
- `findAgentsWithAccess`/`findSocialAgentsWithAccess` gained optional
  `ownerWebId`/`registrySet` params so the share filters evaluate from the
  CONTEXT owner's perspective.
- Follow-up (architecture.md §7.6): retire the now-caller-less synchronous
  `shareDataInstance`.
**Verify:** `test/share-resource.test.ts` wait-for; end-state identical
(response `callbackEndpoint` + grants unchanged); org-context share suite
green.

**Step 4 — decline only; revoke deferred. ✅ DONE (code + packages-verified;
`/test` re-run pending: user).** The deny snapshot is gone from
`AuthorizationGranted` (object = the embedded-POJO array only; decoder wraps
singleton DAs, no snapshot detection; `groupAuthorizationDataAuthorizations` /
`resolveAuthorizationGrantee` / the parent mirror lost the snapshot branch;
an empty/all-filtered grant writes `[]` — the child skips). Decline = a pure
`AuthorizationDenied` (forward-only, no delete). Tests: activity-registry deny
fixture moved to `AuthorizationDenied` (round-trip incl. the single-`@type`
scalar normalization); the components grouping snapshot case dropped;
`resolveActivityGrantee` repinned to the first-DA POJO path;
`test/authorization.test.ts` deny end-state flipped to **grant + grants
UNTOUCHED**. (`/test` note: the deny leg cannot await the registration
Update — a pure decline changes nothing; it runs the reconcile sweep
explicitly and awaits the `AuthorizationDenied` completion instead.)
- `recordAuthorization`: `granted:true` → `AuthorizationGranted`;
  `granted:false` → `AuthorizationDenied` (**pure decline — no
  DataAuthorization delete, no grant clear**; the old delete was accidental).
- `ActivityWebhookHandler` + `reconcileActivities`: add the
  `AuthorizationDenied` branch (forward-only — no workflow, no
  regeneration; the handler returns before dispatch, reconcile completes the
  outbox row); `AuthorizationRevoked` routing stays (no producer here).
- **No revoke producer in this plan.** The regression window is accepted:
  until [`authorization-revocation.md`](authorization-revocation.md) lands the
  revoke action (its designated home), the UI has no withdrawal path.
**Verify:** `authorization.test.ts` — grant (`AuthorizationGranted`); decline
(`AuthorizationDenied`, grants **untouched**). The old "grant → deny → grants
cleared" expectation is **dropped here and moves to the revocation plan** as
the revoke test.

**Step 5 — specific-instance requests (`hasDataInstance` on `AccessNeed`).**
- Extend the need data type + context + embedded round-trip (§6).
- Approval prefills `SelectedFromRegistry` + instance from the need.
**Verify:** `test/access-request.test.ts` — a request naming an instance;
approval records `SelectedFromRegistry` + `hasDataInstance`; the stored request
stays immutable.

**Step 6 — admin authorization naming** (companion plan, may run in parallel).
**Verify:** see [`admin-authorization-naming.md`](admin-authorization-naming.md).

**Step 7 — docs alignment.**
`docs/events.md` rows per class (`AuthorizationGranted` / `AuthorizationDenied`
/ `AuthorizationRevoked`; drop `AuthorizationRequested` / `ShareRequested`);
`docs/features.md` (activity table, trigger classification, view coverage);
`docs/peer.md` if it repeats the producer/consumer rows; `activity-first-services.md`
step 4 cross-refs.
**Verify:** docs reviewed; `likec4 validate` clean.

## 10. Testing

- **`packages` vitest (agent-run):** activity-class union/context/namespace
  compile; handler dispatch + reconcile branches; the workflow activity +
  idempotency (re-delivery) with the `grants.test.ts` mock harness
  (`buildSessionManager` + SPARQL fetcher); the service producers' activity
  shapes.
- **`/test` (user-run, dagger):** authorization grant (wait-for), decline,
  revoke, share-resource (personal + org), and the instance-in-need
  request/approval sequence. Parity guard: the granting end-state is
  identical to today's synchronous result.

## 11. Open decisions

1. ~~Dedicated workflow vs extended per-grantee consumer~~ — **DECIDED:
   dedicated workflows** (`processAuthorizationGranted`, symmetric
   `processAuthorizationRevoked` in the revocation plan). `architecture.md` §4;
   the per-grantee consumer's fate (retire vs regenerate-only) and the
   regeneration shape (self-contained vs signal the consumer) are open below.
2. **`hasDataInstance` on `AccessNeed`** — overload an existing interop term
   (pragmatic) vs a dedicated need-selection term.
3. **Decline notification** — `AuthorizationDenied` stays forward-only
   (silent deny, decided 2026-09; `features.md` note); a requester-side
   notification may be reevaluated later.
4. **Request-axis rename** — `NeedBasedAccessRequest*` → `AccessRequest*`
   (out of scope; recorded for consistency).

## 12. Out of scope here

- The **revocation leg** (`authorization-revocation.md`): UI revoke →
  `AuthorizationRevoked` → grant revocation (the full delegation chain).
- The **admin pair naming** (`admin-authorization-naming.md`).
- The request leg's already-landed mechanics (`AccessRequestRegistry`,
  endpoint validations) — documented in `docs/features.md`.
