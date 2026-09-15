# Access request tracking — grant/archive resolution for need-based access requests

> **Status:** ✅ implemented — steps 1–9 landed, step 10 (consistency pass) done.
> Package checkpoints green at every step (utils/data-model/authorization-agent/
> components vitest + tsc + vue-tsc + vite build); the `/test` dagger e2e tier is
> the remaining user-run validation (step table's right column).
>
> **Step-10 outcomes:** Vuetify `v-badge` `icon`/`content` co-rendering —
> resolved via the custom `#badge` slot (renders direction icon + count
> together; slot precedence beats the mutual-exclusivity of the two props).
>
> **Problem:** an incoming (owner-side) and outgoing (requester-side) access
> request has no first-class "resolved" signal. Correlation today is indirect
> (`DataAuthorization.satisfiesAccessNeed` value-matched against the request's
> embedded need ids), the requester side has **no outcome record at all**, and
> deny is silent/owner-only (`AuthorizationDenied`). The UI's
> `accessRequest`/`accessRequested` indicators therefore never clear.
>
> **Idea:** each side gets a resolution activity that *closes* the request span
> opened by `NeedBasedAccessRequestSent` (requester) /
> `NeedBasedAccessRequestReceived` (owner). Requester side: `AccessRequestGranted`
> and `AccessRequestArchived`. Owner side: the existing
> `AuthorizationGranted`/`AuthorizationDenied` close the span, linked back to the
> request via `satisfiesAccessRequest`.
>
> **Archive must work at any point in the future** — so the UI needs a stable,
> **per-request identity for both directions**, exposed by the profile. The
> current `accessRequest`/`accessRequested` single-value flags must grow into
> **open-request collections**, which also prepares for **multiple pending
> requests per agent pair** (approve/archive any one of them).

---

## 1. Span model under the immutable outbox

Activities are append-only; the only lifecycle is pending→done (`ActivityCompleted`
referencing the original, `immutable-activities.md`). A "span" is therefore:

- **open end** — the request activity: `NeedBasedAccessRequestSent` (requester
  registry, urn:uuid snapshot object) / `NeedBasedAccessRequestReceived` (owner
  registry, real-id projection at the owner-minted request id);
- **resolution end** — a resolution activity that references **the request to
  be resolved** and whose **class carries the outcome type**:

| Class | Registry | Producer | Outcome |
|---|---|---|---|
| `AccessRequestGranted` | requester's | **detector — fire-and-forget child workflow started at the end of `updateDelegatedGrants`** (§3/§7) | request granted → span closed |
| `AccessRequestArchived` | requester's | **UI → RPC** (`archiveAccessRequest`, §4/§8; lives in `services/Authorization.ts`) | user closed a still-open request → span closed |
| `AuthorizationGranted` / `AuthorizationDenied` | owner's | existing `recordAuthorization` (+ `satisfiesAccessRequest`, §5) | owner-side span closed |

Resolutions are **immutable + addressable forever** (the requester's Sent activity
and every resolution persist in the Activity Registry) — which is what makes
"archive at any future point" possible: the open-request list is always derivable
and the archive targets a stable id.

**Terminal resolutions — no `activityCompleted`.** `AccessRequestGranted`,
`AccessRequestArchived` and `AuthorizationDenied` are outcome classes themselves
(their effect IS the activity — nothing materializes afterwards), so they do NOT
need the workflow `pending→done` lifecycle: no workflow runs for them, no
completion is written (`AuthorizationDenied` is the precedent — its completion
only ever came from the manual reconcile sweep, i.e. never in prod). `events.ts`
reacts to their rows at **any** status; `reconcileActivities` treats the classes
as terminal (no dispatch, no completion).

### 1.1 Object shape of the resolution activities

**The full embedded request object is NOT needed** — only `{ id, type }`:

```ts
/** Requester-side resolution: the request was granted. */
export type AccessRequestGranted = Omit<ActivityBase, 'target'> & {
  type: ['Activity', 'AccessRequestGranted']
  actor: string                       // the requester (registry owner)
  object: { id: string, type: string[] }  // id = the Sent activity's SNAPSHOT id (urn:uuid)
}

/** Requester-side user close: an open request was archived. */
export type AccessRequestArchived = Omit<ActivityBase, 'target'> & {
  type: ['Activity', 'AccessRequestArchived']
  actor: string
  object: { id: string, type: string[] }  // the same snapshot id
}
```

The full snapshot (grantee, grantedBy, dataOwner, need group + per-need
`registeredShapeTree`) lives **once**, on the `NeedBasedAccessRequestSent`
activity — the correlation query joins `outcome.object.id → sent.object.id` inside
the same Activity Registry and reads the fields from there.

> `activity-registry.ts` canonicalization: both classes take the urn:uuid-snapshot
> branch (like `NeedBasedAccessRequestSent`/`InvitationAccepted`) with a light
> `{ id, type }` projection.

## 2. Where they fit in the views — **done (Step 1, `docs/temporal.c4`)**

**`request-access` (Bob → Alice):** Bob's `NeedBasedAccessRequestSent` = the
span's **open end** (unchanged); NEW branch appended (later visit — archive at
any point): `Bob.AUI -> Bob.UAS.UiApi 'POST (RPC) archiveAccessRequest'` →
`PUT AccessRequestArchived activity [Activity]` (light `{ id, type }` snapshot
projection, direct write + ownership check, no workflow).

**`approve-access-request` (Alice approves):**

- Alice side closes the owner span: `AuthorizationGranted` (already drawn) now
  carries the flat `satisfiesAccessRequest` (owner-span close — noted on the PUT
  step); the decline branch drills down to the NEW `deny-access-request` view
  (`navigateTo` on the `authorizeApp` step);
- Bob side closes the requester span after the grantee-follow-up:
  `Alice.Registry -> Bob.UAS.WebhookReceiver 'notify Update — registration
  hasDataGrant [Reciprocal]'` → `start updateDelegatedGrants workflow` →
  `(workflow) run` → **`start detectGrantedRequests — fire-and-forget child`** →
  `(workflow) run detectGrantedRequests` → `PUT AccessRequestGranted activity`
  → `notify Add` → `event (pending)` (badge clears; terminal — no completion).

**`deny-access-request` (NEW):** Alice declines (`AuthorizeApp` granted:false →
`AuthorizationDenied` with `satisfiesAccessRequest`, silent / forward-only — no
requester notification).

The span thus *straddles* the diagrams: opens in `request-access`, closes in
`approve-access-request` (grant) or in `request-access` (archive). Deny remains
owner-only — the requester's fallback close is the archive action.

## 3. Detecting "granted" — SPARQL in `packages/authorization-agent/src/sparql.ts`

Runs **requester-side**, as a **fire-and-forget child workflow started at the
end of the `updateDelegatedGrants` workflow** (the same trigger that refreshes
the received-grant view; the child gets its OWN retry policy so a transient
worker failure re-runs the detection itself):

```
updateDelegatedGrants (requester side, on DelegatedGrantsUpdated webhook)
  └─ at its end: await startChild(detectGrantedRequests, …) — NOT the result (fire-and-forget)
       └─ SPARQL open requests × received grants (§3.1/§3.2)
       └─ TS intersection (§3.3) → for each match:
            PUT AccessRequestGranted activity (object = { id: snapshot, type })
            — no activityCompleted (terminal resolution)
```

> **Temporal mechanics (pinned — the dev lesson):** `executeChild` waits for
> the child to finish; `startChild` schedules it and returns a handle
> immediately. **`ParentClosePolicy.ABANDON` is REQUIRED** on the child: the
> DEFAULT policy TERMINATES children when their parent closes — the detector
> was killed the moment `updateDelegatedGrants` returned
> (`workflowExecutionTerminatedEventAttributes, reason: by parent close
> policy`). With ABANDON the child keeps running independently; its own retry
> policy (`maximumAttempts`) makes it self-heal; a derived `workflowId`
> (parent workflowId + suffix) dedupes re-issued StartChild commands on
> parent retries.

> Join anchors (self-requests): on the request `grantedBy === grantee === requester`;
> on a received grant the requester is `grantee` and the owner `grantedBy`. So the
> match is `request.grantedBy ↔ grant.grantee`, not `grant.grantedBy`!
>
> The received-grant view resolves in the dev/test env because the requester's
> `sparqlEndpoint` queries the shared store (federation.md shortcut 1 — Bob's
> store exposes Alice's grant graphs). No mirror write is needed for the detector.

### 3.1 Open requests (requester side) — sent activities WITHOUT a referencing resolution activity

```sparql
PREFIX interop: <https://www.w3.org/ns/solid/interop#>
PREFIX as: <https://www.w3.org/ns/activitystreams#>

SELECT DISTINCT ?sent ?request ?grantee ?grantedBy ?dataOwner ?shapeTree WHERE {
  GRAPH ?g {
    ?sent a interop:NeedBasedAccessRequestSent ; as:object ?request .
    ?request a interop:NeedBasedAccessRequest ;
             interop:grantee ?grantee ;
             interop:grantedBy ?grantedBy ;
             interop:dataOwner ?dataOwner ;
             interop:hasAccessNeedGroup ?needGroup .
    ?needGroup interop:hasAccessNeed ?need .
    ?need interop:registeredShapeTree ?shapeTree .
  }
  # still open — no granted/archived activity referencing the same snapshot
  FILTER NOT EXISTS {
    GRAPH ?g2 {
      VALUES ?resolutionClass { interop:AccessRequestGranted interop:AccessRequestArchived }
      ?outcome a ?resolutionClass ; as:object ?request .
    }
  }
}
```

**The shape is the profile source for both directions:**

- **outgoing** (`accessRequestsSent`, §4): per dataOwner — the `?request` ids
  (snapshot ids) — replaces today's `getSentAccessRequestsByDataOwner` which
  discards the request identity (returns only the dataOwner `Set<string>`);
- **incoming-open** (owner side, §4/§5): requests in the AccessRequestRegistry
  **without** an `AuthorizationGranted`/`AuthorizationDenied` referencing them —
  note this is NOT the object-join used above: on the owner side the resolution
  references the request via the **flat `satisfiesAccessRequest` field** (§5):

  ```sparql
  PREFIX interop: <https://www.w3.org/ns/solid/interop#>
  PREFIX ldp: <http://www.w3.org/ns/ldp#>

  SELECT DISTINCT ?request ?grantee WHERE {
    GRAPH <$registry> { <$registry> ldp:contains ?request . }
    GRAPH ?request {
      ?request a interop:NeedBasedAccessRequest ;
               interop:grantee ?grantee .
    }
    # still open — no granted/denied activity referencing it
    FILTER NOT EXISTS {
      GRAPH ?resolution {
        VALUES ?resolutionClass { interop:AuthorizationGranted interop:AuthorizationDenied }
        ?resolution a ?resolutionClass ;
                    interop:satisfiesAccessRequest ?request .
      }
    }
  }
  ```

  Replaces today's `getAccessRequestsOnRegistry` which lists *all* requests
  (the "never clears" cause). Container membership reads `ldp:contains` in the
  **regular graph only** (the meta-graph cleanup, §6/Step 6).

### 3.2 Received grants (the requester's plane — mirrored/reciprocal view)

```sparql
PREFIX interop: <https://www.w3.org/ns/solid/interop#>

SELECT DISTINCT ?grant ?grantedBy ?shapeTree WHERE {
  GRAPH ?g {
    ?grant a interop:DataGrant ;
           interop:grantee <$requester> ;   # the requester (bound from 3.1)
           interop:grantedBy ?grantedBy ;
           interop:registeredShapeTree ?shapeTree .
  }
}
```

### 3.3 Matching (TS-side intersection of 3.1 × 3.2)

For each open request `r`: **granted** iff ∃ grant with

- `grant.grantee === r.grantedBy` (requester — `=== r.grantee` on self-requests), **and**
- `grant.grantedBy === r.dataOwner` (the owner), **and**
- `grant.registeredShapeTree ∈ r.shapeTrees` (need-group intersection; Inherited
  child grants carry the child tree and match child needs).

On a match the detector writes `AccessRequestGranted` (object `{ id: r.request, type }`)
and the requester span closes. **Best-effort match — adopted** (§6 decisions);
exact correlation stays a deferred follow-up.

### 3.4 Suggested `sparql.ts` functions

- `getOpenSentAccessRequests(transport)` → `{ sent, request, grantee, grantedBy, dataOwner, shapeTrees }[]`
  (requester side; feeds `accessRequestsSent` + the detector);
- `getOpenAccessRequestsOnRegistry(transport, containerIri)` → `{ id, grantee }[]`
  (owner side; incoming-open, requires §5 back-link);
- `getDataGrantsForGrantee(transport, webId)` → grants (`grantedBy`, `registeredShapeTree`);
- Detector orchestration stays in the temporal child workflow, not SPARQL.

## 4. Profile fields, UI and the archive action

### 4.1 `SocialAgent` profile — flags become open-request collections

Current (`packages/api-messages/src/effect.ts`): `accessRequested: Boolean` +
`accessRequest: optional(IRI)` — single-value, boolean/bool-ish. **Dropped** (the
"drop it" decision — in-repo only, breaking change accepted, codebase stays
clean). Replace with per-direction open-request lists (both derived by §3.1
shape; each entry is a stable, immutable id):

```ts
/** incoming — OPEN need-based access requests from this agent (owner side):
 *  AccessRequest IRIs (approval entries — open the authorization screen) */
accessRequestsReceived: S.Array(IRI)

/** outgoing — OPEN need-based access requests sent to this agent (requester
 *  side): the request snapshot ids (urn:uuid — archive targets) */
accessRequestsSent: S.Array(IRI)
```

- built in `buildSocialAgentProfile` from `getOpenAccessRequestsOnRegistry` /
  `getOpenSentAccessRequests` (grouped per listed agent by `grantee`/`dataOwner`);
- keeps the "open" semantics: **granted** (incoming via `AuthorizationGranted`
  with `satisfiesAccessRequest`; outgoing via the §3 detector /
  `AccessRequestGranted`) and **archived** both drop the entry → the indicators
  finally clear.

### 4.2 UI — per-request visibility (now and the multi-request future)

- **Badges** become direction icons + counts (`SocialAgentList.vue`):
  - **incoming** (Access button) — `mdi-inbox` with the count in
    `:content="accessRequestsReceived.length"` (button stays enabled only when
    `accessRequestsReceived.length > 0`);
  - **outgoing** (Data button) — `mdi-outbox` with
    `:content="accessRequestsSent.length"`;
  - (Vuetify `v-badge` `icon`/`content` co-rendering to confirm at
    implementation — if the two props are exclusive, keep the icon via a
    custom badge slot or the button's `prepend-icon` and the count in
    `content`);
- **Peer detail** (when you open that agent): list each open incoming request
  (shape-tree summary from its embedded group) with **approve** (existing
  `request: <iri>` → authorization screen) and **arbitrary selection** of which
  one to approve; list each open outgoing request with **archive**;
- **Archive action**: `archiveAccessRequest({ request: <snapshotId> })` RPC on the
  requester's AA — validates ownership, writes `AccessRequestArchived`, the
  request leaves `accessRequestsSent` on refresh. Works on any later visit
  because the snapshots + resolutions are immutable and the profile re-derives
  the open set (§3.1). **Home: `packages/components/src/services/Authorization.ts`**
  (`ShareResource.ts` dropped from the plan — it hosts share/request-access; the
  archive is a resolution RPC like `recordAuthorization`).

### 4.3 Multiple requests per agent pair

The collections already support it (§4.1) — no schema work needed beyond the
arrays; the peer-detail list is where the second/third request becomes visible
and selectable (approve/archive per entry). The `AuthorizeApp` approval path is
already per-request (`accessRequestIri`).

## 5. Owner-side back-link — `satisfiesAccessRequest` (required for incoming-open)

`recordAuthorization` already holds `accessRequestIri`. Add a **flat
`satisfiesAccessRequest` on `AuthorizationGranted`/`AuthorizationDenied`
(activity-level — pinned: `recordAuthorization` receives exactly ONE
`accessRequestIri`; per-DA duplication adds nothing)**. **Required:**
without it the owner-side "open" set cannot exclude resolved requests (today it
lists everything → the badge never clears). The owner-side span then reads:
`NeedBasedAccessRequestReceived` (open) + `AuthorizationGranted`/`Denied` with
`satisfiesAccessRequest` (closed).

## 6. Decisions

- **Naming** — `AccessRequestGranted` / `AccessRequestArchived`.
- **Archive payload** — `{ request: <snapshotId> }` from `accessRequestsSent` —
  the profile is the identity source; no reliance on the send-time ack.
- **Detector home** — **fire-and-forget child workflow `detectGrantedRequests`
  started via `await startChild(...)` (result un-awaited) at the end of the
  `updateDelegatedGrants` workflow** (requester side, when the received-grant
  view is fresh); the child carries its own retry policy; the resolution is
  terminal (no `activityCompleted`).
- **Granularity of "granted"** — best-effort grantee/owner/shape-tree
  intersection (adopted); exact correlation stays a deferred follow-up
  (`satisfiesAccessNeed` on `DataGrant`, or an owner→requester notification —
  the `features.md` caveat).
- **Deny** — stays silent/owner-only; the requester's fallback close is the
  archive action. Revisit only if requester-side deny UX is ever needed
  (authorization-granting.md §11.3).
- **Profile schema coupling** — resolved: `packages/components` now depends on
  `@janeirodigital/sai-api-messages@^1.0.0-rc.26`, so in-repo bumps on the
  same `1.0.0-rc.*` tuple keep resolving to the workspace copy (UI uses
  `file:`). A future `1.1.0`/stable line needs a range update.
- **Legacy flags** — **removed** (`accessRequest`/`accessRequested` gone — the
  collections replace them; breaking change accepted, codebase stays clean; all
  `SocialAgent.make` call sites incl. the synthetic reciprocal profiles in
  `getSocialAgents` are updated in the same step).
- **Double-resolution conflict** — the `archiveAccessRequest` RPC
  rejects/no-ops when the request already has a resolution (granted ∧ archived
  race; the owner side has no such race — grant vs deny are exclusive).
- **Owner-side open-set query** — the §3.1 incoming-open SPARQL (flat
  `satisfiesAccessRequest` filter) is the adopted sketch.
- **`ldp:contains` — regular graph only** — `ldp:contains` must NOT live in
  `meta:` graphs. Step 6 removes the `meta:` UNION reads (`findRolesWithMember`)
  and verifies seeds/runtime-created containers store membership in the regular
  graph (runtime-created ones already do via `SparqlDataAccessor`).
- **Terminal resolutions — no `ActivityCompleted`** — `AccessRequestGranted` /
  `AccessRequestArchived` / `AuthorizationDenied` are outcome classes
  themselves: no workflow, no completion (the `AuthorizationDenied` precedent —
  its done-row only ever came from the manual sweep). `events.ts` reacts to
  their rows at any status; `reconcileActivities` treats them as terminal
  (no dispatch, no completion write). The UI's immediate refresh is driven by
  the RPC ack + the events row.
- **Detector gap — accepted** — a missed `DelegatedGrantsUpdated` webhook is
  the only way detection never runs (child retry covers transient failures);
  the badge stays stale, recoverable by archive, self-heals on any later grant
  leg. The sweep is NOT wired to re-trigger detection.

### Remaining open (deferred, non-blocking)

- Requester-side deny UX (see Deny above).
- Exact grant↔request correlation follow-up (`features.md`).
- ~~Vuetify `v-badge` `icon`/`content` co-rendering~~ — **resolved at step 9**: the
  custom `#badge` slot renders direction icon + count together (slot precedence
  beats the mutual exclusivity of the two props).

## Proposed order of steps (dependencies + test checkpoints)

Each step leaves the test suite green (additive steps touch nothing; the one
breaking step is isolated). **You** verify `/test` (dagger e2e); the agent can
run the `packages/*` vitest suites between steps.

| # | Step | Touches | Green after (agent) | Green after (you, /test) |
|---|---|---|---|---|
| 1 | ✅ **Diagrams** — `request-access` archive path; `approve-access-request` detector closure + `satisfiesAccessRequest` note + deny drill-down; NEW `deny-access-request` | `docs/temporal.c4` | `npx likec4 validate --json --no-layout --file docs/temporal.c4 .` | — |
| 2 | ✅ **Vocabulary + data-model** — `INTEROP` terms `AccessRequestGranted`/`AccessRequestArchived`/`satisfiesAccessRequest`; context defs; the two activity types + flat field on both authorization classes + `ActivityData` union | `utils/namespaces.ts`, `data-model/context.ts`, `data-model/activities.ts` | packages vitest ✅ | — |
| 3 | ✅ **activity-registry canonicalization** — cases for both classes (light `{ id, type }` projection) + `satisfiesAccessRequest` passthrough; regression tests | `authorization-agent/activity-registry.ts`, `authorization-agent/test/activity-registry.test.ts` | packages vitest ✅ | — |
| 4 | ✅ **SPARQL** — add `getOpenSentAccessRequests`/`getOpenAccessRequestsOnRegistry`/`getDataGrantsForGrantee` (old two stay until step 9); unit tests via the mocked-endpoint pattern (`find-roles-with-member.test.ts` precedent) | `authorization-agent/sparql.ts`, NEW `authorization-agent/test/open-requests.test.ts` | packages vitest ✅ | — |
| 5 | ✅ **Owner back-link** — `recordAuthorization` writes flat `satisfiesAccessRequest` from `accessRequestIri` (granted + denied) | `components/services/Authorization.ts` | packages vitest ✅ | authorization.test.ts approve + denied (additive triple — no assertion changes); NEW deny-via-request case (stored `AuthorizationDenied` carries `satisfiesAccessRequest`) |
| 6 | ✅ **`ldp:contains` regular-graph cleanup** — drop `meta:` UNION reads; audit seeds | `authorization-agent/sparql.ts` (`findRolesWithMember`), `environments/data/*` | packages vitest ✅ | roles/reconciliation e2e |
| 7 | ✅ **Requester detector** — new temporal activities (reads + PUT `AccessRequestGranted`); `detectGrantedRequests` fire-and-forget child workflow (`await startChild` with `ParentClosePolicy.ABANDON`, derived workflowId, child retry policy); `updateDelegatedGrants` starts it at its end; `events.ts` row (status-agnostic); matcher unit tests | `components/temporal/activities/access-request.ts`, `components/temporal/workflows/access-request.ts`, `components/temporal/workflows/grants.ts`, `ui/authorization/src/events.ts` | packages vitest ✅ (+ matcher tests, `grants.test.ts` pattern) | NEW: authorize → Bob's open set clears (extend authorization.test.ts / access-request.test.ts) |
| 8 | ✅ **Archive RPC** — `ArchiveAccessRequest` Rpc.effect + `AccessRequestArchived` message; `archiveAccessRequest` in `Authorization.ts` (ownership = sent activity with actor === ctx.webId; double-resolution no-op); `ApiHandler` route; `events.ts` row (status-agnostic) | `api-messages/effect.ts`, `components/services/Authorization.ts`, `components/ApiHandler.ts`, `ui/authorization/src/events.ts` | packages vitest ✅ | NEW: archive → open set drops, double-archive no-op (access-request.test.ts) |
| 9 | ✅ **Profile collections + UI (THE breaking step, landed together)** — drop legacy flags; add `accessRequests`/`accessRequestsSent`; rebuild `buildSocialAgentProfile` (+ synthetic reciprocal profiles); swap `queries/org.ts` re-exports; DELETE the two old SPARQL functions; badges → counts + peer-detail lists (approve/archive) | `api-messages/effect.ts`, `components/services/SocialAgentRegistry.ts`, `components/services/queries/org.ts`, `authorization-agent/sparql.ts`, `ui/authorization/src/views/SocialAgentList.vue`, `DataRegistryList.vue`, `AuthorizeApp.vue` | packages vitest ✅ + UI build ✅ | full e2e sweep (request → approve → clears; request → archive → clears; deny via request → Alice's `accessRequests` drops; multi-request) |
| 10 | ✅ **Final consistency** — biome auto-fixes applied, docs/likec4.md conventions pass, v-badge detail confirmed (custom `#badge` slot), plan marked done | docs | — | full sweep |

Step order rationale: 2→3→4 are pure foundations (nothing consumes the new
query results until step 7/9); step 5 is required before the owner-side open
set can exclude; step 7 depends on 4 (detector reads); step 9 depends on 4+5
(profile reads). Steps 7–9 each add their `events.ts` row when they land.

## Resolved clarifications (final)

All clarifications are now settled — nothing blocks any step:

1. **`satisfiesAccessRequest` activity-level** — confirmed.
2. **Legacy flags removed** — confirmed (step 9 breaking, updated with all
   `SocialAgent.make` call sites).
3. **Terminal resolutions (no `activityCompleted`)** — confirmed.
   `events.ts` reacts at any status; `reconcileActivities` treats the classes
   as terminal.
4. **Fire-and-forget mechanics (pinned)** — `await startChild(...)` at the
   end of `updateDelegatedGrants` with `ParentClosePolicy.ABANDON` (the
   default TERMINATE policy kills children at parent close — the dev
   failure), derived `workflowId` for retry dedup, child retry policy for
   self-healing.
5. **Reconcile-sweep backstop — gap accepted** — the sweep stays manual/test-
   only and is NOT wired to re-trigger detection.
6. **Received-grant view via shared-store shortcut** — confirmed, out of
   production scope.
7. **Deny e2e added** — step 5 asserts the stored `AuthorizationDenied`
   `satisfiesAccessRequest`; step 9 asserts Alice's `accessRequestsReceived` drops.
8. **Vuetify `v-badge` `icon`/`content` co-rendering** — confirm at step 9.

## Touchpoints (when implementing)

- `packages/utils/src/namespaces.ts` — add both class terms + `satisfiesAccessRequest` to `INTEROP`
- `packages/data-model/src/context.ts` — class term defs
- `packages/data-model/src/activities.ts` — the two types + flat field on both authorization classes + `ActivityData` union
- `packages/authorization-agent/src/activity-registry.ts` — canonicalization cases (+ passthrough)
- `packages/authorization-agent/src/sparql.ts` — §3 queries (new three; old two deleted at step 9) + `findRolesWithMember` meta-graph cleanup
- `packages/api-messages/src/effect.ts` — profile fields (§4.1) + `ArchiveAccessRequest` Rpc + `AccessRequestArchived` message
- `packages/components/src/services/Authorization.ts` — `satisfiesAccessRequest` in `recordAuthorization` + `archiveAccessRequest` (owner/requester ownership check)
- `packages/components/src/services/queries/org.ts` — re-export swap (drop old two, export new three)
- `packages/components/src/services/SocialAgentRegistry.ts` — profile build from the open-request queries
- `packages/components/src/ApiHandler.ts` — `archiveAccessRequest` route
- `packages/components/src/temporal/workflows/grants.ts` — `updateDelegatedGrants` starts the fire-and-forget child at its end
- `packages/components/src/temporal/workflows/access-request.ts` + `temporal/activities/access-request.ts` — `detectGrantedRequests` child + its activities
- `ui/authorization/src/events.ts` — outcome rows for `AccessRequestGranted`/`AccessRequestArchived`/`AuthorizationDenied`
- `ui/authorization/src/views/SocialAgentList.vue` / `DataRegistryList.vue` / peer detail — badges + lists + archive action
- `docs/temporal.c4` — **done (Step 1)**
- tests: `test/authorization.test.ts` (grant+deny via request), `test/access-request.test.ts` (archive), `test/reciprocal-webhook.test.ts` (detector), + packages unit tests