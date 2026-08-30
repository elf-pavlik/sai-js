# Plans index

Status snapshot of the implementation plans in this directory, cross-checked
against the current codebase and git history. A plan's own `Status` header is the
primary source.

## Summary

| Status | Count | Plans |
|---|---|---|
| ✅ done | 19 | `cleanup-fetch-utils`, `depend-on-generic-auditing`, `immutable-activities`, `improve-jsonld-use`, `org-context-proxy`, `org-context-sparql`, `refactor-data-instance`, `refactor-data-model`, `refactor-data-model-followup`, `refactor-grants-workflows`, `refactor-ui`, `remove-access-authorization-indirection`, `remove-access-grant-indirection`, `simplify-authorization-containment`, `simplify-factories`, `simplify-grant-as-pojos`, `test-infra-consolidation`, `workflow-temporal-decupling`, `reorganize-authz-agent-logic` |
| 🔶 partial (first cut landed) | 1 | `revoke-delegation-chain` |
| ⬜ not started / design only | 10 | `authorization-revoked`, `check-equivalence`, `durable-webhook-delivery`, `remove-turtle-serialization`, `webhook-subscription-bootstrap`, `federation`, `events`, `registry-set-permissions`, `isolated-datasets-and-sparql`, `components-tweaks` |
| ⬜ follow-up backlog (all items open) | 1 | `revoke-delegation-chain-follow-ups` |

**31 plans total.** All remaining work lives in the 12 non-done plans below —
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
| `federation.md` | ⬜ design note (org-admin companion) | Single-deployment shortcuts the org-admin data-plane relies on: shared SPARQL endpoint, global-fetch UAS/storage discovery, local pod-storage ownership, `hasRegistrySet` link across servers, webhook delivery; future federated lookups | `org-admin-feature` (umbrella) |
| `events.md` | ⬜ design note (org-admin companion) | Domain-event (activityType) catalogue incl. the new `adminAuthorizationRecorded` event → parallel `createAdminGrants` + `syncAdminAcr` workflows; deferred/future events (data-registry-added regeneration, admin revocation) | `workflow-temporal-decupling` (outbox model); `org-admin-feature` (umbrella) |
| `registry-set-permissions.md` | ⬜ not started (design) | Scope the blanket `#fullAdminAccess` per structural registry: per-container ACRs, GrantRegistry owner-only (admins never write grants; per-grant ACRs serve reads), ActivityRegistry Read + create/append (append-only immutable log) instead of blanket Write; seed ACR hygiene for the ACR-less yoyo DataGrants | `org-admin-feature` R1 |
| `org-context-sparql.md` | ✅ done (phases 1–3 landed, committed `50b44bf4`; /test green) | Org-context correctness + read-plane migration, phases 1–3 of this document: dormant reciprocal-mirror writer → all registry-set reads via SPARQL (internal endpoint both contexts, gated `/sparql-admin` — org-context reads now route over HTTP `QUERY`, DPoP-verifiable since access-token-verifier 2.1.2; see `org-context-proxy` last step) → context/session fix (`Context.ts` stops minting org sessions; owner identity from context; class-C fixes). Records the non-cascading-ACR constraint and the seeded-resource mutation + peer-instance-listing gaps as known debt. Phase 4 (per-owner datasets) extracted to `isolated-datasets-and-sparql` | `org-admin-feature` Phase 2 (C2); supersedes its §2.8 registry-set-resolution open items |
| `isolated-datasets-and-sparql.md` | ⬜ not started (design only) | Per-owner datasets + SPARQL: 4a endpoint registry in `AccountLoginStorage` (env-var fallback) → 4b per-owner store cutover (joint checkpoint): mirror activation + backfill, serialized syncs, `/sparql-admin` → the org's own store, external admin-endpoint discovery, environment work, cross-owner isolation + mirror-freshness tests. The IRI-parametrized reads of `org-context-sparql` phases 2–3 resolve to mirrors unchanged | `org-context-sparql` (phases 1–3); `federation.md` shortcuts 1/1a |
| `org-context-proxy.md` | ✅ done (implemented + verified; `/test` org-context proxy parity suite green) | Org-context reads of peers' granted data (the `org-context-sparql` §2.4 known issue): `/.sai/proxy-admin` endpoint (YoYo side — org-credentialed fetch as grantee) + shared admin gate + admin-side clients (`fetchPeerDocument`, `dataRegistrationContains`, `peerInstanceIris`, `peerInstanceNode`); wired `getDescriptions` AllFromRegistry counts (were 0 — dead `[]`-truthiness fallback), `listDataInstances` peer branch (all scopes), `getResource` full-body + org-side access list; registry plane routed via `/sparql-admin` over HTTP `QUERY` (DPoP-verifiable since the token-verifier 2.1.2 added it to its method whitelist). Scope answers: instance listing enters org-context scope **yes** (labels + full bodies); direction 4 = grantee visibility (data grants, not ACRs — the engine resolved the seed grant fine) | `org-context-sparql` (§2.4 + phases 2–3); `isolated-datasets-and-sparql` (4b data-plane analogue) |
| `reorganize-authz-agent-logic.md` | ✅ done | Four behavior-preserving phases, each gated by full build + package tests + `/test` integration: **P1** removes the factories (threaded `factory` param → `{ fetch, randomUUID }`, adds `loadShapeTree`, instance assembly becomes `loadDataInstance` on `data-instance.ts`) and folds in the `iri`→`id` param rename; **P2** extracts application-specific logic to `application` (`Grant.iriForNew`, `ApplicationRegistration.getDataGrants`, `getDataInstanceIterator` duplicated w/ Phase-4 SPARQL TODO); **P3** extracts authorization-specific logic to AA session methods (grant-generation chain, AdminAuthorization block, reciprocal-registration federation) + data-model orphan cleanup; **P4** moves components SAI domain logic to AA (services rules, temporal match semantics, delegation/revocation rules), components keeps CSS handlers, storage, RPC API, webhooks, notifications, workflow glue — adapters convert to/from `api-messages` only | — |
| `components-tweaks.md` | ⬜ design only (investigation write-up) | Residual SAI domain/spec logic still in components after the reorganize phases: extract `SaiPermissionsEngine`'s grant-evaluation predicates (grant→request coverage, Inherited-chain resolution, admin modes) and the 4×-duplicated `hasAdminGrant` admin-marker rule to AA session methods/predicates; move the delegation-endpoint inheritance completion (`GrantIssuanceHandler`) and `buildAdminGrants` materialization to AA; plane-based session `findRegistration` | `reorganize-authz-agent-logic` (§9 deferrals) |

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
- `components-tweaks` — **unblocked**: follows the completed `reorganize-authz-agent-logic` (§9 deferrals + residual engine/admin-marker findings); the extraction is component-side only (AA session methods/predicates, engine keeps the plugin adapter).

### D. Org-admin workstream companion docs

`org-admin-feature.md` is the umbrella for the org-admin workstream (itself not
tracked in this index). Four companions:

- `federation.md` — design note; cross-checks with `org-admin-feature` §2.4 (C2)
  and the engine path in `registry-set-permissions`.
- `events.md` — design note; builds on the `workflow-temporal-decupling` outbox
  model (the `activityWorkflows` map / `GRANTEE_ACTIVITY_TYPES` dispatch).
- `registry-set-permissions.md` — ⬜ design; follow-up to `org-admin-feature` R1.
- `org-context-sparql.md` — ✅ done (phases 1–3 landed: dormant mirror
  writer; SPARQL read plane; context/session fix); per-owner phase 4
  extracted to `isolated-datasets-and-sparql`.
- `isolated-datasets-and-sparql.md` — ⬜ design; extracted phase 4:
  per-owner datasets + SPARQL endpoints, mirror activation + backfill,
  external admin-endpoint discovery — joint `/test` checkpoint at the
  store-split cutover.
- `org-context-proxy.md` — ✅ done (implemented + verified); extracted
  §2.4 known issue: the org-as-grantee proxy (`/.sai/proxy-admin`) +
  admin-side clients for peers' granted data instances; also routes the
  org-context registry plane via `/sparql-admin` (last step).

## Federation

**[`federation.md`](federation.md)** — design note, not a tracked plan:
documents the **single-deployment shortcuts** the org-admin data plane
relies on and what actually breaks once servers/stores split. It is the
primary reference for the per-owner work; each shortcut maps to a plan
below:

| `federation.md` shortcut | What it is | Plan(s) that address / depend on it |
|---|---|---|
| **1 — shared SPARQL store** | one triple store behind the registry + data servers; every graph visible from every endpoint | `org-context-sparql.md` phases 2–3 (reads resolve against it today); ended by the `isolated-datasets-and-sparql.md` 4b store split |
| **1a — reciprocal mirrors** | the federated replacement for cross-graph reads: org-local copies of peers' registrations + grants, named after the source IRIs | `org-context-sparql.md` phase 1 (dormant writer; IRI-parametrized queries make the cutover query-free); `isolated-datasets-and-sparql.md` 4b (activation, backfill, serialized syncs) |
| **2 — UAS/storage discovery via global fetch** | discovery uses the global fetch, not a session-bound one — fine on one compose network | no dedicated plan yet; revisit when servers split across hosts (noted in `federation.md`) |
| **3 — pod/storage ownership is local** | `podStore.getOwners` decides "owner of this storage" per server | no dedicated plan yet (the data-plane admin-status path, see "Cases the design must keep working" in `federation.md`) |
| **4 — org's AA serves the registry-set link across servers** | the *intended* federation shape for the registry plane: `Link: rel="interop:hasRegistrySet"` served by the org's agent-id doc, resolved by the admin's AA | `org-admin-feature.md` §2.4 (C2, umbrella — not tracked in this index) |
| **5 — activity/outbox delivery on one notification path** | webhooks from the org's Activity Registry → admin UI assume co-location | `durable-webhook-delivery.md` (cross-server delivery, ⬜); `webhook-subscription-bootstrap.md` (channel provisioning for real deployments, ⬜) |

Directly related plans: **`isolated-datasets-and-sparql.md`** (the
per-owner cutover that ends shortcut 1 and makes 1a load-bearing),
**`org-context-sparql.md`** (phases 2–3 consume shortcut 1; phase 1 writes
shortcut 1a's mirrors), **`org-context-proxy.md`** ✅ (the data-plane
analogue — org-context reads of peers' granted *data instances*, which
neither the shared store's registry metadata nor the mirrors cover), and
the two webhook-delivery plans above (shortcut
5). Adjacent: `registry-set-permissions.md` (which server's ACRs grant
what across owners — seed hygiene for ACR-less yoyo DataGrants).

## Security

Security-relevant work that spans plans is catalogued here; a section of
the plan is only listed once the plan spells out an enforcement boundary.
For now:

- **[`isolated-datasets-and-sparql.md`](isolated-datasets-and-sparql.md)** —
  the per-owner SPARQL read plane's authorization boundaries: per-owner
  endpoint records in `AccountLoginStorage` (4a), the `/sparql-admin`
  `hasAdminGrant` gate forwarding into the org's own store (4b, closing
  the who-not-which-graphs caveat), the mirror **single-writer invariant**
  (only server-side sync writes mirror graphs; admin code read-only), and
  the cross-owner isolation tests (Dan querying Alice's endpoint → 403 by
  gate; no cross-graph leakage even at his own endpoint).
- **[`org-context-proxy.md`](org-context-proxy.md)** — the admin-gated
  peer-data proxy's enforcement boundary: `requireOrgAdmin` (caller must be
  an admin of the org; unknown org indistinguishable from non-admin) runs
  before any upstream work; GET-only with an http(s)-only target (the org's
  credentials never point at other schemes); JSON-LD-only contract (pinned
  `Accept`, upstream content-type guard — no binary); upstream
  authorization stays the **peer's permission engine** (safe-by-grant —
  the org's credentials only succeed where the org holds a data grant);
  the two sessions (admin's and org's) never coexist in one handler.

(More plans will be listed here as their security aspects are spelled
out — e.g. ACR/ACP scoping such as `registry-set-permissions.md`.)

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
| `org-context-proxy.md` ✅ | `ProxyAdminHandler` (`/.sai/proxy-admin`, admin gate in `services/adminGate.ts` shared with `AdminSparqlHandler`) + `AdminSparqlHandler` accepting HTTP `QUERY` only (safe read-only method for the org-context registry-plane reads) |
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
⁸ `reorganize-authz-agent-logic.md` — §9 deferred items (org-context registry reads + UI shaping, admin-marker reciprocal read, HTTP `AgentRegistry.findRegistration`, HTTP admin reads) are now tracked as the ⬜ `components-tweaks.md` (investigation write-up, no code changed).

