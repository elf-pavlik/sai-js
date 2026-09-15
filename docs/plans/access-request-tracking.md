# Access request tracking — grant/archive resolution for need-based access requests

> **Status:** 🧪 sketch (exploration — nothing implemented)
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
| `AccessRequestGranted` | requester's | grantee AA — piggybacked on the reciprocal-leg regeneration (`updateDelegatedGrants`-adjacent, §3) | request granted → span closed |
| `AccessRequestArchived` | requester's | **UI → RPC** (`archiveAccessRequest`, §4) | user closed a still-open request → span closed |
| `AuthorizationGranted` / `AuthorizationDenied` | owner's | existing `recordAuthorization` (+ `satisfiesAccessRequest`, §5) | owner-side span closed |

Resolutions are **immutable + addressable forever** (the requester's Sent activity
and every resolution persist in the Activity Registry) — which is what makes
"archive at any future point" possible: the open-request list is always derivable
and the archive targets a stable id.

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

## 2. Where they fit in the views

**`docs/temporal.c4` → `request-access` (Bob → Alice):**

- Bob's `NeedBasedAccessRequestSent` = the span's **open end** (unchanged);
- NEW branch, Bob side — archive at any point:
  `Bob.AUI -> Bob.UAS.UiApi 'POST (RPC) archiveAccessRequest'` →
  `PUT AccessRequestArchived activity [Activity]` — drawn as an alternative
  path off a still-pending request (can happen on any later visit);
- Alice's `NeedBasedAccessRequestReceived` stays the owner-side open end.

**`approve-access-request` (Alice approves):**

- Alice side closes the owner span: `AuthorizationGranted` (already drawn),
  now with `satisfiesAccessRequest` — the deny branch closes it in the new
  `deny-access-request` diagram (Before-implementation section);
- Bob side closes the requester span **on the grantee-follow-up step we already
  added** (`Alice.Registry -> Bob.UAS.WebhookReceiver 'notify Update — registration
  hasDataGrant [Reciprocal]'`): after it,
  `Bob.UAS.WebhookReceiver -> Bob.Registry 'PUT AccessRequestGranted activity'`.

The span thus *straddles* the two diagrams: opens in `request-access`, closes in
`approve-access-request` (grant) or in `request-access` (archive). Deny remains
owner-only — the requester's fallback close is the archive action.

## 3. Detecting "granted" — SPARQL in `packages/authorization-agent/src/sparql.ts`

Runs **requester-side**, after the reciprocal/`DelegatedGrantsUpdated` leg has
refreshed the received-grant view (the same trigger that runs
`updateDelegatedGrants`/`syncReciprocalMirror`; the reconcile sweep is the
backstop).

> Join anchors (self-requests): on the request `grantedBy === grantee === requester`;
> on a received grant the requester is `grantee` and the owner `grantedBy`. So the
> match is `request.grantedBy ↔ grant.grantee`, not `grant.grantedBy`!

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
  (the "never clears" cause).

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
- Detector orchestration stays in the caller (temporal activity/workflow), not SPARQL.

## 4. Profile fields, UI and the archive action

### 4.1 `SocialAgent` profile — flags become open-request collections

Current (`packages/api-messages/src/effect.ts`): `accessRequested: Boolean` +
`accessRequest: optional(IRI)` — single-value, boolean/bool-ish. Replace with
per-direction open-request lists (both derived by §3.1 shape; each entry is a
stable, immutable id):

```ts
/** incoming — OPEN need-based access requests from this agent (owner side):
 *  AccessRequest IRIs (approval entries — open the authorization screen) */
accessRequests: S.Array(IRI)

/** outgoing — OPEN need-based access requests sent to this agent (requester
 *  side): the request snapshot ids (urn:uuid — archive targets) */
accessRequestsSent: S.Array(IRI)
```

- built in `buildSocialAgentProfile` from `getOpenAccessRequestsOnRegistry` /
  `getOpenSentAccessRequests` (grouped per listed agent by `grantee`/`dataOwner`);
- keeps the "open" semantics: **granted** (incoming via `AuthorizationGranted`
  with `satisfiesAccessRequest`; outgoing via the §3 detector /
  `AccessRequestGranted`) and **archived** both drop the entry → the indicators
  finally clear;
- legacy `accessRequest`/`accessRequested` can stay as derived
  `length > 0` / `first()` conveniences or be dropped (UI is in-repo; the
  server/UI api-messages coupling was resolved by switching `packages/components`
  to `^1.0.0-rc.26` — §6.6).

### 4.2 UI — per-request visibility (now and the multi-request future)

- **Badges** become direction icons + counts (`SocialAgentList.vue`):
  - **incoming** (Access button) — `mdi-inbox` with the count in
    `:content="accessRequests.length"` (button stays enabled only when
    `accessRequests.length > 0`);
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
  the open set (§3.1).

### 4.3 Multiple requests per agent pair

The collections already support it (§4.1) — no schema work needed beyond the
arrays; the peer-detail list is where the second/third request becomes visible
and selectable (approve/archive per entry). The `AuthorizeApp` approval path is
already per-request (`accessRequestIri`).

## 5. Owner-side back-link — `satisfiesAccessRequest` (required for incoming-open)

`recordAuthorization` already holds `accessRequestIri`. Add a flat
`satisfiesAccessRequest` on `AuthorizationGranted`/`AuthorizationDenied`
(activity-level) — or per-DA, mirroring `satisfiesAccessNeed`. **Required**:
without it the owner-side "open" set cannot exclude resolved requests (today it
lists everything → the badge never clears). The owner-side span then reads:
`NeedBasedAccessRequestReceived` (open) + `AuthorizationGranted`/`Denied` with
`satisfiesAccessRequest` (closed).

## 6. Decisions

- **Naming** — `AccessRequestGranted` / `AccessRequestArchived`.
- **Archive payload** — `{ request: <snapshotId> }` from `accessRequestsSent` —
  the profile is the identity source; no reliance on the send-time ack.
- **Detector home** — piggyback on the reciprocal-leg regeneration
  (`updateDelegatedGrants`-adjacent code, when the received-grant view is
  fresh); the reconcile sweep stays the backstop.
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
- **Legacy flags** — removed (`accessRequest`/`accessRequested` gone — the
  collections replace them; breaking change accepted, codebase stays clean).
- **Double-resolution conflict** — the `archiveAccessRequest` RPC
  rejects/no-ops when the request already has a resolution (granted ∧ archived
  race; the owner side has no such race — grant vs deny are exclusive).
- **Owner-side open-set query** — the §3.1 incoming-open SPARQL (flat
  `satisfiesAccessRequest` filter) is the adopted sketch.

### Remaining open (deferred, non-blocking)

- Requester-side deny UX (see Deny above).
- Exact grant↔request correlation follow-up (`features.md`).
- Vuetify `v-badge` `icon`/`content` co-rendering detail (§4.2) — confirm at
  implementation.

## Before implementation — diagram updates (`docs/temporal.c4`)

Update the sequence diagrams as part of the implementation (NOT after):

- **`request-access`** — new sequences on Bob's side: the archive path
  (`Bob.AUI -> Bob.UAS.UiApi 'POST (RPC) archiveAccessRequest'` →
  `PUT AccessRequestArchived activity [Activity]`) as an alternative closure
  off a still-pending request (can happen on any later visit);
- **`approve-access-request`** — new sequences: `AccessRequestGranted` written
  on Bob's side right after the `notify Update — registration hasDataGrant
  [Reciprocal]` step (the requester span closes here); owner-span closure via
  `satisfiesAccessRequest` on `AuthorizationGranted`;
- **deny** — a NEW diagram (`deny-access-request`) as the final step: Alice
  declines (`AuthorizeApp` granted:false → `AuthorizationDenied`, silent /
  forward-only — no requester notification), reached from
  `approve-access-request` via the navigateTo drill-down pattern;
- follow **`docs/likec4.md`** conventions (include ordering / mirrored peers
  pattern, step + note callout shapes, `[Reciprocal]` step tags, real ids from
  tests/seeds) and use the **`/skill:likec4-dsl`** skill; validate with
  `npx likec4 validate --json --no-layout --file docs/temporal.c4 .`.

## Touchpoints (when implementing)

- `packages/utils/src/namespaces.ts` — add both class terms to `INTEROP`
- `packages/data-model/src/context.ts` — class term defs
- `packages/data-model/src/activities.ts` — the two types + `ActivityData` union
- `packages/authorization-agent/src/activity-registry.ts` — canonicalization cases
- `packages/authorization-agent/src/sparql.ts` — §3 queries
- `packages/api-messages/src/effect.ts` — profile fields (§4.1) +
  `AccessRequestArchived` activity + `archiveAccessRequest` RPC
- `packages/components/src/services/ShareResource.ts` (+ `ApiHandler` route) —
  the `archiveAccessRequest` RPC producer (writes `AccessRequestArchived`,
  ownership check)
- `packages/components/src/services/SocialAgentRegistry.ts` — profile build
- `ui/authorization/src/views/SocialAgentList.vue` / `DataRegistryList.vue` —
  badges + peer-detail lists + archive action
- `ui/authorization/src/events.ts` — outcome rows refresh the list/badge
- `docs/temporal.c4` — §2 steps in `request-access` + `approve-access-request`