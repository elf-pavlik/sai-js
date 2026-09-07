# Authorization granting — `recordAuthorization` + `shareResource` (+ access request)

> **Status: design only — extracted out of `activity-first-services.md`
> steps 7–8 (2026-09), then joined by the access-request leg (`requestAccess
> UsingApplicationNeeds`, formerly its step 10 — matching the revocation
> plan's extraction), re-framed (2026-09) as the `NeedBasedAccessRequest`
> leg: the registration-link mechanism (`setAccessNeedGroup`) is dropped;
> the request rides a NEW `NeedBasedAccessRequest` type through the data
> owner's **reused grant-issuance endpoint** (no new endpoint/term), lands
> as an immutable AccessRequest in the owner's new **AccessRequestRegistry**
> (activity-first, 202 Accepted), and the kept RPC becomes the same
> activity-first producer — see §6.** The two main moves ride **structure types**
> (`AuthorizationStructure`, `DataAuthorizationStructure`,
> `ShareDataInstanceStructure`) whose fields have NO `dataModelContext` terms
> — the term-gap (execution note 9 in `payload-contract-alignment.md`) is why
> the POJO-first reorder moved them to the end, and why they now live here as
> one plan: the **granting leg**, counterpart of
> [`authorization-revocation.md`](authorization-revocation.md). The access-
> request leg has NO structure types — it
> rides along as the plan's third scope row, re-framed as the
> `NeedBasedAccessRequest` leg (§6).

## 1. Scope — the granting leg

The activity-first moves for the two granting RPCs (was steps 7–8 of
`activity-first-services.md`):

| RPC | activity class(es) | Structure types in play |
|---|---|---|
| `recordAuthorization` (`AuthorizeApp`) | `authorizationRecorded` (+ the `Revoked` carrier for the deny path — cross-ref the revocation plan) | `AuthorizationStructure` / `DataAuthorizationStructure` |
| `shareResource` | `authorizationRecorded` (one per deduped grantee) | `ShareDataInstanceStructure` / `DataAuthorizationStructure` + `applicationId` |
| access request — **`NeedBasedAccessRequest`** (re-framed, §6; the `requestAccessUsingApplicationNeeds` registration-link leg is dropped) | the NEW type `NeedBasedAccessRequest` + the activity pair (`NeedBasedAccessRequestSent` / `NeedBasedAccessRequestReceived`) — `{ grantee, grantedBy, dataOwner, hasAccessNeedGroup }` (+ embedded access need group) | **none** (plain IRIs + an embedded group — the term-gap does not apply); the payload goes through the REUSED grant-issuance endpoint (`GrantIssuanceHandler`), activity-first into the owner's new AccessRequestRegistry (202 Accepted) |

**Access-request leg** — re-framed as the `NeedBasedAccessRequest` leg (§6):
**Bob requests access from Alice** (`grantedBy` = Bob, `dataOwner` = Alice,
`grantee` = Bob — self-request, `grantee === grantedBy` enforced); the access
need group rides **embedded** in the request (framed, self-contained;
descriptions a follow-up); the data owner's NEW **AccessRequestRegistry**
holds immutable request records anchored by an activity. The endpoint is the
**reused grant-issuance endpoint** (`issuanceUrl(dataOwner)`, dispatched by
payload type in `GrantIssuanceHandler` — no new endpoint/term), responding
**202 Accepted** after the activity-first write. The kept
`requestAccessUsingApplicationNeeds` RPC becomes the same activity-first
producer (its service method extracts the access needs from the application's
client-id document, then activity + workflows are identical to the endpoint
leg). The `accessRequested` profile flag now derives from the
AccessRequestRegistry (follow-up, §6.6).

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
- The **verify-only keeper** `createRole` and the **housekeeping**
  (`addSocialAgent`) stay in `activity-first-services.md` (steps 9–10).
  `requestAccessUsingApplicationNeeds` is NOT verify-only anymore — it is
  this plan's requesting-authorization leg (§6): kept as the RPC, reworked
  to the activity-first producer whose workflow POSTs to the data owner's
  (reused) endpoint.
- The **registration-link mechanism** (`setAccessNeedGroup` on the grantor's
  registration of the grantee) — dropped with the re-frame; the flow relies
  on the reference to the immutable AccessRequest instead (§6).
- The flat `AuthorizationRequested` / `ShareRequested` classes
  (`payload-contract-alignment.md` §5 follow-up) — **this plan RESOLVES their
  fate**: **use** (Decision A picks the flat carrier → complete their routing —
  today they are unroutable stubs: no `loadActivity` cases, no
  handler/reconcile rows, no producers) **or drop** (remove the types, union
  members, context/namespaces terms + api-messages projections). The decision
  is recorded when the carrier is settled (section 2).

## 6. The requesting-authorization leg — `NeedBasedAccessRequest`

**Direction (demo + `/test` parity): Bob requests access from Alice** —
`grantedBy` = Bob, `dataOwner` = Alice, and — Bob requesting for himself —
`grantee` = Bob as well (the grantee-to-be). `grantee === grantedBy` is
**enforced** at the endpoint: needs-based requests are self-requests, the
delegation use cases stay at the grants level (the existing
`AccessRequest`/`AccessRevocation` issuance flow). The app (test-client) is
NOT involved at the protocol level — the access need group rides **inside
the request** (framed, self-contained); only the kept RPC still derives it
from the application's client-id document (§6.4). The registration-link
mechanism (`setAccessNeedGroup` on the grantor's registration of the
grantee) is **dropped** — the flow revolves around an **immutable**
AccessRequest record in the data owner's new **AccessRequestRegistry**,
anchored by an activity.

### 6.1 Wire type + payload

One new type `NeedBasedAccessRequest` (`interop:NeedBasedAccessRequest` —
**distinct from** the delegation `AccessRequest`/`AccessRevocation` message
types in `data-model/src/access-request.ts`; added to
`utils/src/namespaces.ts`). Covers the endpoint message `type` AND the
registry-resource class; the ACTIVITY layer uses TWO classes: the
`NeedBasedAccessRequestSent` (grantedBy/requester side) and
`NeedBasedAccessRequestReceived` (dataOwner side) — one class per
event/side, the codebase convention; dispatch never sniffs the object form.

```json
{
  "@context": "https://www.w3.org/ns/solid/interop#",
  "type": [ "interop:NeedBasedAccessRequest" ],
  "grantee": "https://id/bob",
  "grantedBy": "https://id/bob",
  "dataOwner": "https://id/alice",
  "hasAccessNeedGroup": { "...": "the access need group, framed" }
}
```

`hasAccessNeedGroup` carries the access need group **embedded** (framed,
self-contained). Payloads are **compacted JSON-LD per `dataModelContext`** —
interop terms compact to BARE keys (`grantee`, `dataOwner`,
`hasAccessNeedGroup`, `required`, …) with NO `interop:` prefix; the context
must define every term used (an implementation TODO: extend `context.ts` so
no prefix appears on the wire). The embedded group + its needs carry
**urn:uuid ids** (the accept-invitation snapshot precedent) — the content
mirrors the seeded `#need-group-pm` group (`environments/data/registry.trig`:
Project + inherited Task/Image/File, `https://data/shapetrees/trees/*`).
First pass: NO description literals (the access needs structure);
follow-up: the English-descriptions form. **The group is embedded COMPLETE
in every activity `as:object`** (requester- and owner-side, steps 3 + 10 of
the c4) — the SPARQL read plane constructs the needs from the activity
graph ALONE (`docs/sparql.md`: one graph, two subjects; type-matching
queries carry the `FILTER(?g = ?s)` self-graph guard).

### 6.2 The endpoint leg — reuse of the grant-issuance endpoint

**No new endpoint, no new advertised term.** The access request POSTs to the
**existing grant-issuance endpoint** — `issuanceUrl(dataOwner)` =
`/.sai/grants/{base64url(webId)}` (the scoped form
`delegation-endpoint.test.ts` uses; the unscoped `/.sai/grants` advertised
in the client-id doc routes to the same handler). `GrantIssuanceHandler`
gains a third dispatch branch — the guard `isNeedBasedAccessRequestMessage`
in `components/src/messages.ts` (mirrors `isAccessRequestMessage`):

- `AccessRevocation` (+ grant IRIs) → revocation (unchanged);
- `AccessRequest` (+ `grants`) → issuance (unchanged);
- `NeedBasedAccessRequest` → this leg.

POST-restricted already (the router's `allowedMethods: ["POST"]`). The
endpoint now REQUIRES `Content-Type: application/ld+json` (a non-JSON-LD
content type is rejected — the new branch and the existing delegation
branches alike, keeping the endpoint uniform; `delegation-endpoint.test.ts`
gets the header added to its POSTs).

Validations (all before any write, all-or-nothing; status codes decided
2026-09):

1. `Content-Type: application/ld+json` (else 415);
2. `credentials.agent.webId` present (else **401 Unauthorized** —
   `UnauthorizedHttpError` — NOT 403: missing credentials is an
   authentication failure; the existing handler throws
   `ForbiddenHttpError` there today, changed);
3. client is the requester's UAS: `credentials.client.clientId ===
   discoverAuthorizationAgent(credentials.agent.webId)` (else **403** — the
   existing issuance check, TODOs unchanged — and the same 403 covers a
   MISSING social-agent registration: neither is an auth failure, both are
   authorization failures);
4. `grantedBy === grantee === credentials.agent.webId` (else 400);
5. `dataOwner` resolves to a session: `getSession(dataOwner)`;
6. the requester has a **social-agent registration** in the registry owned
   by the authz agent's webid: `getSession(dataOwner)
   .findSocialAgentRegistration(credentials.agent.webId)` exists (**else
   403** — grouped with the wrong-client case per the code decision) — the
   "handler only allows POST from agents registered with the owner" ask.

Then activity-first (the plan's template, the `InvitationCreated` form):
pre-mint the request id (`iriForContained(registrySet.hasAccessRequestRegistry,
randomUUID)`) and write the `NeedBasedAccessRequestReceived` activity in the **data
owner's** Activity Registry — `actor` = dataOwner, `target` = the
AccessRequest registry, `as:object` = the **real-id embedded projection** of
the request-to-be at the minted id. The activity `type` tuple is
**`['Activity', 'NeedBasedAccessRequestReceived']` — NO `as:` verb**: the
class terms live in OUR interop namespace (`namespaces.ts`), matching
`AuthorizationRecorded` (the ASV verbs are only borrowed where the wire
convention adopted them). Respond **202 Accepted with an EMPTY
body** (`new ResponseDescription(202)` — no existing handler returns a
non-200 success; the bare-`ResponseDescription(200)` pattern precedent is
`ActivityWebhookHandler`; nothing consumes a body — the requester-side
workflow and the tests assert status only).

### 6.3 The AccessRequestRegistry (new)

The RegistrySet of every agent gains `hasAccessRequestRegistry`
(`<id>access-request/`): vocab term, `dataModelContext` term,
`RegistrySetData` + `fromJsonLd`, `templates/RegistrySet.ts` graph
(bootstrap auto-covers new accounts via `registrySetTemplate`), and the
**seeded graphs in `environments/data/registry.trig`** for all registry sets
(acme, alice, bob, kim, yoyo, dan, … — same shape as the other seeded
registries).

The stored AccessRequest is **immutable — no status field**. Granting is a
follow-up: it produces an authorization + the derived grants and only ever
*references* the request ("the rest of the flow relies on a reference to
that request"); the only lifecycle signal is the activity completion
(pending → done). Resource shape:

```json
{
  "id": "<minted in the owner's access-request registry>",
  "type": [ "interop:NeedBasedAccessRequest" ],
  "grantee": "...", "grantedBy": "...", "dataOwner": "...",
  "hasAccessNeedGroup": "<the embedded group>"
}
```

Framed via the existing `grantee`/`grantedBy`/`dataOwner`/`hasAccessNeedGroup`
terms in `dataModelContext` (all present today). Read plane for the `/test`
parity: `listContained` + a new `getAccessRequest` in `queries/org.ts`
(SPARQL, mirroring the other registry reads) — the needs resolve from the
activity graph (self-contained embed, §6.1) or the stored resource, both
under the `?g = ?s` self-graph guard.

### 6.4 The RPC leg (kept)

`requestAccessUsingApplicationNeeds` stays (api-messages class, `ShareResource`
service, `ApiHandler` wiring) for the UI path; its logic changes:

- the service method (components `ShareResource.ts`) **extracts the access
  needs** — from the application's client-id document (the current
  `loadClientIdDocument(applicationIri)` → `hasAccessNeedGroup`) — and
  builds the SAME request payload as §6.2 (`grantee = grantedBy = ctx.webId`
  — the session user, i.e. Bob; `dataOwner` = the `webId` argument, i.e.
  Alice; `hasAccessNeedGroup` embedded). **From that point down the activity
  + workflows are identical to the endpoint leg** — when the follow-up RPC
  (whole group + descriptions embedded) lands, only this extraction changes.
- activity-first: writes the `NeedBasedAccessRequestSent` class in the
  **requester's** Activity Registry. The object rides as a **urn:uuid
  snapshot** — the requester has no AccessRequestRegistry to mint into,
  mirroring the `InvitationAccepted` acceptor-side snapshot; the REAL id is
  minted owner-side (§6.2). No `target` on the requester-side activity.
- the requester-side workflow `getSession(requester)` POSTs the request to
  `issuanceUrl(dataOwner)` (the reused endpoint), expects **202**, then
  marks the activity done — the `done` here means **"forwarded"**, NOT
  "granted": the grant outcome arrives LATER via a webhook notification
  when the owner approves (§6.8).

Dispatch (`ActivityWebhookHandler` + `reconcileActivities`): ONE branch
PER class, no object-form sniffing — `NeedBasedAccessRequestSent`
(requester-side: target-less urn:uuid snapshot object) → the forwarding
workflow; `NeedBasedAccessRequestReceived` (owner-side: `target` = the
AccessRequest registry + real-id object) → the materializing workflow.

**Follow-up (NOT this plan):** a new RPC carrying the whole access need
group + descriptions embedded (the endpoint payload becomes fully
self-contained); the applicationId RPC may then be retired. Only the
service-method extraction changes — the activity + workflows stay as built
here.

> [!NOTE]
> the `request-access` c4 view (§7 step 0) already reflects THIS target
> shape — the need group rides the RPC message (urn:uuid ids), NO app in the
> flow; the interim applicationId extraction is deliberately not drawn.

### 6.5 Workflows

- **owner-side**: input `{ dataOwner, request, activity ref }` — PUT the
  AccessRequest at the minted id (`getSession(dataOwner)`, find-first
  idempotent) → `activityCompleted`.
- **requester-side**: input `{ requester, request, activity ref }` —
  `getSession(requester).authFetch(issuanceUrl(dataOwner), { method: "POST",
  body: <the request> })` → 202 expected → `activityCompleted`.

**Idempotency note:** a retried requester POST re-runs the owner handler and
mints a NEW request (no dedupe key yet). Accepted for the first pass —
requests are immutable and duplicates are inert until the granting leg
consumes them; a dedupe key (e.g. the requester's activity id riding the
payload, find-first on the owner side) is an execution-time option.

### 6.6 Wiring checklist

- `utils/src/namespaces.ts`: `AccessRequestRegistry`, `hasAccessRequestRegistry`,
  `NeedBasedAccessRequest`, `NeedBasedAccessRequestSent`, `NeedBasedAccessRequestReceived`.
- `data-model/src/context.ts`: the terms + the TWO activity-class rows
  (`NeedBasedAccessRequestSent`, `NeedBasedAccessRequestReceived`) +
  `hasAccessRequestRegistry` term.
- `data-model/src/registry-set.ts`: `RegistrySetData.hasAccessRequestRegistry`
  + `fromJsonLd`.
- `data-model/src/templates/RegistrySet.ts`: `interop:hasAccessRequestRegistry
  <${id}access-request/>` + container graph.
- `data-model/src/access-request.ts` (or a sibling module):
  `NeedBasedAccessRequestData` (with the embedded-group typing; descriptions
  follow-up); `data-model/src/activities.ts`: the
  `NeedBasedAccessRequestSent` (urn:uuid snapshot object) +
  `NeedBasedAccessRequestReceived` (real-id object) activity types;
  `isActivityClass` union.
- `components/src/messages.ts`: `isNeedBasedAccessRequestMessage` guard.
- `components/src/GrantIssuanceHandler.ts`: the third dispatch branch + the
  §6.2 validations (incl. the `application/ld+json` content-type gate) + mint
  + activity + 202.
- `components/src/ActivityWebhookHandler.ts`: dispatch branch PER class
  (`NeedBasedAccessRequestSent` → requester workflow; `NeedBasedAccessRequestReceived`
  → owner workflow); `components/src/temporal/workflows/`: requester- +
  owner-side workflows (new module or `grants.ts`), `reconcileActivities`
  branches (one per class).
- `components/src/services/ShareResource.ts`: the RPC service-method rework
  (extract → activity-first). RPC success becomes a pending ack echoing the
  requester activity id — `{ accepted: true, activityId }`, the
  `InvitationAcceptedMessage` shape (the requester mints no real id — the
  owner does — so the ack carries only the claim anchor, matching the
  accept-invitation precedent; the minted-id producers echo `id` +
  `activityId`, this one cannot).
- api-messages: the TWO activity projections (`NeedBasedAccessRequestSent`,
  `NeedBasedAccessRequestReceived` — Schema classes, `loadActivity` cases) + the RPC success pending-ack (the confirmed
  `{ accepted: true, activityId }` shape, §6.6); `effect.ts` RPC entry
  unchanged (same class name).
- `components/src/ActivityEvents.ts` / `docs/events.md`: row per type.
- `ui/authorization`: `activityLabels.ts` rows for BOTH new activity classes
  (`NeedBasedAccessRequestSent` / `NeedBasedAccessRequestReceived`) +
  `locales/*.ftl` keys (the "add their row" rule); `events.ts`
  completion-driven refresh (completed `NeedBasedAccessRequestReceived` →
  refresh the approvals/social-agents list; `Sent` → the step-0 claim
  rows); `store/app.ts` `requestAccess` call site (interim keeps the
  applicationId shape per §6.4 — swaps to the target
  `{ dataOwner, hasAccessNeedGroup }` shape with the follow-up RPC);
  `getAuthoriaztion` `accessRequestIri` pass-through (approval, §6.8).
- Seeds: `environments/data/registry.trig` (all registry sets),
  `test/setup.ts` parity if it seeds registry sets.
- `/test`: three wait-for suites, one per leg + the full sequence (§7 steps
  3–5): the **leg-A test** (endpoint — Bob's UAS POST to
  `issuanceUrl(aliceId)`), the **leg-B test** (RPC UI path), the
  **full-sequence test** (both legs converge on Alice's
  AccessRequestRegistry). `delegation-endpoint.test.ts` gets the
  `Content-Type: application/ld+json` header added to its POSTs (the
  whole-endpoint gate, confirmed 2026-09) — coverage otherwise untouched.
- docs/c4: rewrite the `request-access` view in `docs/temporal.c4` AND add a
  NEW `authz-data-need-based-request` view — **Step 0, the user gate: BEFORE
  any implementation** (§7), so the exact flow + payloads are confirmable;
  the registration-PATCH steps removed. The existing `authorization-data-app`
  view is left ALONE — it stays app-centric unless our changes force an
  adjustment (note: the approval data-flow lives only in the new view; if
  `getDescriptions`' app branch is later touched, revisit).
  `events.md`/`peer.md` rows + `activity-first-services.md` row 4i cross-ref
  align with the wiring steps below (no more `setAccessNeedGroup` PATCH).
- `SocialAgentRegistry.buildSocialAgentProfile`: `accessRequested` now
  derives from the AccessRequestRegistry listing (follow-up with the
  granting leg — the registration `hasAccessNeedGroup` source is gone).

### 6.7 Open / execution notes

- **Org-context scope**: the endpoint validation targets the dataOwner's OWN
  registry (`getSession(dataOwner)`) — whether an org's registry-set accepts
  requests is a follow-up question; the first pass is personal-context only.
- **`accessRequested` badge + UI claim rows** land with the parity suite
  (§6.6); the badge's new source (the AccessRequestRegistry listing) is the
  phase-2 approval entry (§6.8).
- **Granting-side consumption** of the AccessRequest (Alice authorizes → an
  authorization + grants referencing the request) is the follow-up,
  adjacent to the existing `recordAuthorization` leg of this plan — it only
  reads the immutable request, never mutates it.

### 6.8 The approval phase (phase 2 — follow-up)

Approving a `NeedBasedAccessRequest` REUSES the existing granting machine —
the `recordAuthorization` leg (§1) and the authorization screen in
`ui/authorization` (`AuthorizeApp.vue` — `store/app.ts` `getAuthoriaztion` /
`authorizeApp`) — no new authorization workflow, no second registry:

1. **Entry**: the owner's pending requests surface through the
   `accessRequested` marker on the social-agent profile (which now derives
   from the AccessRequestRegistry listing, §6.6) and open the existing
   authorization screen for the request's grantee (`agentType` =
   SocialAgent).
2. **`getDescriptions` adjustment** (`components/src/services/Authorization.ts`):
   the access need group comes from the **embedded group in the request**,
   NOT fetched from a URI — the SocialAgent branch's
   `reciprocalRegistration?.hasAccessNeedGroup` source is gone (the link was
   dropped). Proposal: a new optional `accessRequestIri` argument on
   `GetAuthoriaztionData` → the service loads the immutable request from the
   context owner's registry (SPARQL `getAccessRequest`, §6.3) and resolves
   the group from its embedded copy; `dataOwners` stays the context owner's
   data registrations (`findUserDataRegistrations` — the request's
   `dataOwner` IS the context). The `AuthorizeApp.vue` screen itself needs no
   structural change — it renders `authorizationData.accessNeedGroup` and
   reads `accessNeedGroup.id` from the embedded group.
3. **`recordAuthorization` reuse (unchanged)**: the screen builds the
   `Authorization` (grantee = the request's grantee, `agentType` SocialAgent,
   `accessNeedGroup` = the embedded group's id, the selected data
   registrations per need) → `AuthorizeApp` →
   `recordAuthorizationFromStructure` writes the DataAuthorizations + the
   derived grants (§1's workflow/consumer chains run untouched).
4. **Immutability**: the AccessRequest is only READ — the authorization
   *references* it; nothing mutates the stored request (matches §6.3).
5. **Requester notification (follow-up, with the granting leg)**: once the
   authorization is granted and the grants are generated, a webhook
   notification updates the REQUESTER side — Bob's UI learns the outcome
   (granted/denied) through that channel, not through the phase-1 flows
   (the `NeedBasedAccessRequestSent` `done` = forwarded, §6.4).

## 7. Implementation order — a working test after every step

Every step leaves both the `packages` vitest suites and `/test` green. The
`/test` coverage is one test PER LEG plus one FULL-SEQUENCE test (steps
3–5, all wait-for style). **Step 0 is the user gate — nothing implemented
before it.**

**Step 0 — `docs/temporal.c4` first (GATE).** Rewrite the `request-access`
view (reflecting the TARGET shape: the need group rides the RPC message
with urn:uuid ids — the app is NOT in the flow; payloads compacted via
`dataModelContext`, no `interop:` prefix) and add a NEW
`authz-data-need-based-request` view so the exact flow + payloads are
confirmable BEFORE any code changes; the existing `authorization-data-app`
view is left alone (stays app-centric unless our changes force an
adjustment — noted in §6.6):

- `request-access`: ONE flow, invitation-style, starting with the RPC (the
  direct leg-A endpoint POST is NOT drawn — the `/test` leg-A suite covers
  it): Bob's UI → notifications stream (`.sai/events`) → `(RPC)
  requestAccessUsingApplicationNeeds` (the need group rides the message,
  urn:uuid ids) → requester activity (urn:uuid snapshot, no target) →
  `{ accepted: true, activityId }` pending ack → requester-side workflow →
  THE `POST NeedBasedAccessRequest` to the REUSED issuance endpoint
  (`issuanceUrl(aliceId)`; `Content-Type: application/ld+json`; compacted
  `{ grantee, grantedBy, dataOwner, hasAccessNeedGroup }`) →
  `GrantIssuanceHandler` validations → mint + activity in Alice's registry
  (target = the AccessRequestRegistry) → **202 empty body** (awaits
  NOTHING — the requester-side workflow completes on it) → the two sides
  then run in PARALLEL, any order (the diagram's order is arbitrary):
  requester `activityCompleted` → `done` event on Bob's stream, and the
  owner-side workflow PUTs the AccessRequest (its own `activityCompleted`).
  The view's `alt` early-returns on validation failure (`if 'validation
  fails'` → 403, flow ends — no mint, no webhook, no workflow). The
  registration-PATCH steps are gone.
- `authz-data-need-based-request` (NEW — approval phase, §6.8): the access
  need group comes from the embedded request (`getAuthorizationData` with
  `accessRequestIri`), NOT from the app's client-id document or the
  reciprocal registration; the authorize step navigates to the existing
  `authorization` view (reused screen).

The user confirms the flow + payloads; steps 1+ follow. The doc rows
(`events.md`, `peer.md`, `activity-first-services.md` row 4i) align within
the wiring steps below.

**Step 1 — vocabulary + data types (no behavior).** `namespaces.ts`
(`AccessRequestRegistry`, `hasAccessRequestRegistry`, `NeedBasedAccessRequest`,
`NeedBasedAccessRequestSent`, `NeedBasedAccessRequestReceived`);
`context.ts` terms + the TWO activity-class rows; `registry-set.ts`
(`hasAccessRequestRegistry`, consistent with the existing registries);
the data-model access-request module (`NeedBasedAccessRequestData` + the
message gate + embedded-group typing; descriptions follow-up); `activities.ts`
activity types (`NeedBasedAccessRequestSent` urn:uuid snapshot /
`NeedBasedAccessRequestReceived` real-id object); api-messages projections. **Tests:** existing `packages` vitest suites stay green (no behavior
changed).

**Step 2 — the AccessRequestRegistry (template + seeds).**
`templates/RegistrySet.ts` (`interop:hasAccessRequestRegistry
<${id}access-request/>` + container graph) + `environments/data/registry.trig`
for every registry set (acme, alice, bob, kim, yoyo, dan, …). **Tests:** the
registry-set framing paths the existing org-context / agent-discovery
`/test` suites exercise stay green.

**Step 3 — Leg A: the endpoint branch.** `messages.ts`
(`isNeedBasedAccessRequestMessage`) + `GrantIssuanceHandler` third branch
(the §6.2 validations incl. the WHOLE-endpoint `application/ld+json` gate,
mint + activity, **202 empty body**) + the owner-side workflow +
`ActivityWebhookHandler` dispatch + `reconcileActivities` branch + events
rows. **Tests:** `test/access-request.test.ts` rewritten as the **leg-A
test** — Bob's UAS POSTs to `issuanceUrl(aliceId)` (header + embedded
test-client group), expects 202 with an EMPTY body, waits for the owner-side
`NeedBasedAccessRequestReceived` completion, asserts the stored AccessRequest fields
(grantee/grantedBy/dataOwner/hasAccessNeedGroup) via SPARQL.
`delegation-endpoint.test.ts` header updates green (whole-endpoint gate).

**Step 4 — Leg B: the RPC leg.** `ShareResource` service-method rework
(extract the access needs from the application's client-id document →
activity-first; `grantee = grantedBy = ctx.webId`, `dataOwner` = the
`agentId` argument — confirmed mapping 2026-09), api-messages success =
`{ accepted: true, activityId }`, the requester-side workflow
(`NeedBasedAccessRequestSent` — one dispatch branch per class, no
form-sniffing). `ui/authorization` `store/app.ts` `requestAccess` call site
stays with the current applicationId shape (the swap to the target
`{ dataOwner, hasAccessNeedGroup }` shape rides the follow-up RPC, §6.4).
**Tests:** the **leg-B test** (new) — Bob's UI cookie → RPC
→ pending ack → the requester
workflow POSTs → Alice's registry holds the request → requester activity
completes.

**Step 5 — the full-sequence test.** One test driving BOTH legs end-to-end
and asserting they converge on Alice's AccessRequestRegistry with identical
request fields, both sides' activities complete (quiescence). **Tests:** the
full-sequence test green; the whole `/test` suite green.

**Step 6 — the approval phase (phase 2, follow-up — §6.8).**
`getDescriptions` `accessRequestIri` (+ the SocialAgent branch's
reciprocal-registration source removal), the `ui/authorization` approval
plumbing (`store/app.ts` `getAuthoriaztion` `accessRequestIri` pass-through;
`activityLabels.ts`/`events.ts` rows; the `accessRequested` marker — now
sourced from the AccessRequestRegistry listing — opening the existing
authorization screen), the approval `/test` (Alice authorizes Bob's request
→ DataAuthorizations + derived grants; the stored AccessRequest stays
immutable). Reuses the §1 granting machinery — no new authorization
workflow.
