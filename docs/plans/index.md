# Plans index

Status snapshot of the implementation plans in this directory, cross-checked
against the current codebase and git history. A plan's own `Status` header is the
primary source.

All **completed** implementation plans have been removed; their resulting design
is documented in the [OpenWiki](../openwiki/index.md).

## Summary

| Status | Count | Plans |
|---|---|---|
| ✅ complete | 1 | `esm-jsr-no-build` |
| 🔶 partial | 1 | `revoke-delegation-chain` |
| ⬜ not started / design only | 16 | `authorization-revoked`, `authorization-revocation`, `check-equivalence`, `durable-webhook-delivery`, `remove-turtle-serialization`, `webhook-subscription-bootstrap`, `federation`, `events`, `registry-set-permissions`, `isolated-datasets-and-sparql`, `components-tweaks`, `specific-instance-access-requests`, `generic-auditing`, `extract-temporal-workflows`, `production-consumer-cleanup`, `jsr-publishing` |
| ⬜ follow-up backlog (all items open) | 1 | `revoke-delegation-chain-follow-ups` |

**19 plans total.**

## Full table

| Plan | Status | What it does | Depends on |
|---|---|---|---|
| `revoke-delegation-chain.md` | 🔶 partial — first cut (steps 1–5) landed | Revocation as a boundary operation at the delegation endpoint (`AccessRevocation`, all-or-nothing validation, requester hop, `RevokeGrants` RPC); replaces direct cross-peer DELETE | references `authorization-revoked` (deny-RPC precedent) |
| `authorization-revoked.md` | ⬜ not done (design only) | Producer writes the typed `authorizationRevoked` activity for deny; routing/consumer/sweep already handle the type | — |
| `authorization-revocation.md` | ⬜ not done (design only — deferred) | The authorization-revocation leg, extracted from `activity-first-services` step 4: UI revokes an **authorization** (never grants directly) → the `authorizationRevoked` producer → a workflow revokes the derived grants at the **issuance boundary with the org session** (fixes seeded-ACR 403) + clears the grantor's projection; decides whether the retired `grantsRevoked`/`processGrantsRevocation` wiring is revived (the `activity-first` step-4 cleanup retires the dormant temporal artifacts) | `authorization-revoked` (the typed producer); `revoke-delegation-chain` (+ its follow-ups — the boundary + `grantsRevoked` observability item); `activity-first-services` (steps 4 cleanup, 7–8 carrier re-pins) |
| `check-equivalence.md` | ⬜ not done (design only) | Real `checkEquivalence`: reuse equivalent existing grants (incl. child trees); workflow already fully wired | — |
| `durable-webhook-delivery.md` | ⬜ not done (design only) | `DurableWebhookEmitter` enqueues a `deliverWebhook` Temporal workflow (bounded retries, 4xx non-retryable) on registry/data servers | `forward-to-push` worker |
| `webhook-subscription-bootstrap.md` | ⬜ not done (design only) | `ensureActivityWebhookChannel` at account creation + startup/periodic healing for real deployments (dev/test are pre-seeded) | — |
| `remove-turtle-serialization.md` | ✅ phases 0–6 landed (phase 7 `n3` drop ⬜) | Drops `parseTurtle`/`serializeTurtle`: `toNQuads` for SPARQL patches, JSON-LD ACRs, `application/ld+json` CONSTRUCT, named-graph N-Quads mirror, NDJSON notification streams (custom CSS components) | builds on the landed `fetchJsonLd`/`putJsonLd` infra; external `@elfpavlik/sai-components` |
| `revoke-delegation-chain-follow-ups.md` | ⬜ all 9 items open | Items 1–9 of the revocation follow-up: full chain calculation, scope/mode-coverage ordering, replace-vs-delete race, grantor trigger integration (`grantsRevoked` producer), grantee self-revocation, error-detail schema, drop vestigial `delegationOfGrant`, sweep validation, `reconcileActivities` scheduling | `revoke-delegation-chain` (first cut) |
| `federation.md` | ⬜ design note (org-admin companion) | Single-deployment shortcuts the org-admin data-plane relies on: shared SPARQL endpoint, global-fetch UAS/storage discovery, local pod-storage ownership, `hasRegistrySet` link across servers, webhook delivery; future federated lookups | `org-admin-feature` (umbrella) |
| `events.md` | ⬜ design note (org-admin companion) | Domain-event (activityType) catalogue incl. the new `adminAuthorizationRecorded` event → parallel `createAdminGrants` + `syncAdminAcr` workflows; deferred/future events (data-registry-added regeneration, admin revocation) | `org-admin-feature` (umbrella) |
| `registry-set-permissions.md` | ⬜ not started (design) | Scope the blanket `#fullAdminAccess` per structural registry: per-container ACRs, GrantRegistry owner-only (admins never write grants; per-grant ACRs serve reads), ActivityRegistry Read + create/append (append-only immutable log) instead of blanket Write; seed ACR hygiene for the ACR-less yoyo DataGrants | `org-admin-feature` R1 |
| `isolated-datasets-and-sparql.md` | ⬜ not started (design only) | Per-owner datasets + SPARQL: 4a endpoint registry in `AccountLoginStorage` (env-var fallback) → 4b per-owner store cutover (joint checkpoint): mirror activation + backfill, serialized syncs, `/sparql-admin` → the org's own store, external admin-endpoint discovery, environment work, cross-owner isolation + mirror-freshness tests. The IRI-parametrized org-context SPARQL reads resolve to mirrors unchanged | `federation.md` shortcuts 1/1a |
| `components-tweaks.md` | ⬜ design only (investigation write-up) | Residual SAI domain/spec logic still in components after the reorganize phases: extract `SaiPermissionsEngine`'s grant-evaluation predicates (grant→request coverage, Inherited-chain resolution, admin modes) and the 4×-duplicated `hasAdminGrant` admin-marker rule to AA session methods/predicates; move the delegation-endpoint inheritance completion (`GrantIssuanceHandler`) and `buildAdminGrants` materialization to AA; plane-based session `findRegistration` | — |
| `esm-jsr-no-build.md` | ✅ complete | ESM-only source, no build step for the 5 interop libs, Node 26 native TS everywhere, `tsgo --noEmit` typecheck (strict), `.ts` imports, vitest 5 on Node; deferred work split into the plans below | — |
| `production-consumer-cleanup.md` | ⬜ not started | nix packages/images → Node 26 + repo source (drop `buildNpmPackage`/`pkgs.nodejs`/`dist`); `services/id`, `ui/authorization`, `docs/website`, README, dagger/compose | `esm-jsr-no-build` (D5=A, D10=B) |
| `jsr-publishing.md` | ⬜ not started (future goal) | Publish the 5 interop libs to JSR as TypeScript source (`jsr.json`, slow-type fixes, dep staging, GH Actions workflow); `components` stays npm | `esm-jsr-no-build` (ESM/no-build/`.ts` groundwork landed) |
| `extract-temporal-workflows.md` | ⬜ not started — blocked on a cycle decision | Move all Temporal code out of `packages/components` into a private `temporal-workflows` package and shrink `components` to Components.js-only; a `components ↔ temporal` dependency cycle needs option A/B/C resolved first | overlaps `components-tweaks.md` |
| `specific-instance-access-requests.md` | ⬜ not started (design only) | Access requests targeting specific data instances (`hasDataInstance` on `AccessNeed`); deferred from the granting work — no request-side caller yet | — |
| `generic-auditing.md` | ⬜ not started (design only) | A generic auditing mechanism for creation metadata (creator agent/client, creation/modification times), replacing the removed hand-written `interop:registeredBy`/`registeredWith`/`registeredAt`/`updatedAt` writes | — |

## Dependency graph

Read `→` as "depends on / builds on". All completed lineage plans have been
removed; the surviving plans are the open work items.

### Grant workflows & the activity outbox

```
revoke-delegation-chain 🔶 (403 → boundary revocation)
  └─ revoke-delegation-chain-follow-ups ⬜ (items 1–9)

authorization-revoked ⬜        (deny activity producer)
authorization-revocation ⬜     (depends on authorization-revoked + revoke-delegation-chain)
check-equivalence ⬜            (replaces the shipped checkEquivalence dummy)
durable-webhook-delivery ⬜     (forward-to-push worker)
webhook-subscription-bootstrap ⬜
remove-turtle-serialization ⬜
```

### Org-admin workstream companion docs

`org-admin-feature.md` is the umbrella for the org-admin workstream (itself not
tracked in this index). The landed org-context read plane and the
`/.sai/proxy-admin` / `/sparql-admin` endpoints are documented in the OpenWiki
(`services/org-context.md`). The remaining companions:

- `federation.md` — design note; cross-checks with `org-admin-feature` §2.4 (C2)
  and the engine path in `registry-set-permissions`.
- `events.md` — design note; builds on the activity outbox model (the
  `activityWorkflows` map / `GRANTEE_ACTIVITY_TYPES` dispatch).
- `registry-set-permissions.md` — ⬜ design; follow-up to `org-admin-feature` R1.
- `isolated-datasets-and-sparql.md` — ⬜ design; per-owner datasets + SPARQL
  endpoints, mirror activation + backfill, external admin-endpoint discovery —
  joint `/test` checkpoint at the store-split cutover.

### Independent / deferred

- `components-tweaks` — **unblocked**: follows the completed reorganize work
  (residual engine/admin-marker findings); component-side extraction only.
- `specific-instance-access-requests` — deferred granting scope; no
  request-side caller yet.
- `generic-auditing` — future creation-metadata mechanism; the removed writes
  had no readers.
- `remove-turtle-serialization` — independent of the workflow/revocation arcs.
- `revoke-delegation-chain-follow-ups` — depends only on the landed first cut;
  internal ordering: 1 (chain calc) → 2 (coverage ordering) → 4 (trigger
  integration); 3 (replace-vs-delete race) is orthogonal; 8 → 9 (sweep
  validation then scheduling).
- `check-equivalence` — **unblocked**: `createGrantsForAgent` already consumes
  `reused`; only the activity needs a real implementation.
- `authorization-revoked` — **unblocked**: routing, per-target consumer and
  sweep already support the type; only `recordAuthorization` needs to write it.
- `durable-webhook-delivery` — **unblocked**: needs the emitter + workflow +
  `TEMPORAL_ADDRESS` on the registry/data services.
- `webhook-subscription-bootstrap` — **unblocked**: builds on the landed
  ActivityRegistry module + `ActivityWebhookStore`/handler; runtime-only
  (dev/test are pre-seeded).

## Federation

**[`federation.md`](federation.md)** — design note, not a tracked plan:
documents the **single-deployment shortcuts** the org-admin data plane
relies on and what actually breaks once servers/stores split. It is the
primary reference for the per-owner work; each shortcut maps to a plan
below:

| `federation.md` shortcut | What it is | Plan(s) that address / depend on it |
|---|---|---|
| **1 — shared SPARQL store** | one triple store behind the registry + data servers; every graph visible from every endpoint | the org-context SPARQL read plane (reads resolve against it today; see the OpenWiki); ended by the `isolated-datasets-and-sparql.md` 4b store split |
| **1a — reciprocal mirrors** | the federated replacement for cross-graph reads: org-local copies of peers' registrations + grants, named after the source IRIs | the dormant reciprocal-mirror writer (see the OpenWiki); `isolated-datasets-and-sparql.md` 4b (activation, backfill, serialized syncs) |
| **2 — UAS/storage discovery via global fetch** | discovery uses the global fetch, not a session-bound one — fine on one compose network | no dedicated plan yet; revisit when servers split across hosts (noted in `federation.md`) |
| **3 — pod/storage ownership is local** | `podStore.getOwners` decides "owner of this storage" per server | no dedicated plan yet (the data-plane admin-status path, see "Cases the design must keep working" in `federation.md`) |
| **4 — org's AA serves the registry-set link across servers** | the *intended* federation shape for the registry plane: `Link: rel="interop:hasRegistrySet"` served by the org's agent-id doc, resolved by the admin's AA | `org-admin-feature.md` §2.4 (C2, umbrella — not tracked in this index) |
| **5 — activity/outbox delivery on one notification path** | webhooks from the org's Activity Registry → admin UI assume co-location | `durable-webhook-delivery.md` (cross-server delivery, ⬜); `webhook-subscription-bootstrap.md` (channel provisioning for real deployments, ⬜) |

Directly related plans: **`isolated-datasets-and-sparql.md`** (the
per-owner cutover that ends shortcut 1 and makes 1a load-bearing), the two
webhook-delivery plans above (shortcut 5), and `registry-set-permissions.md`
(which server's ACRs grant what across owners — seed hygiene for ACR-less
yoyo DataGrants). The landed org-context read plane and proxy endpoints are
documented in the OpenWiki `services/org-context.md`.

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
- The landed `/.sai/proxy-admin` / `/sparql-admin` enforcement boundaries —
  `requireOrgAdmin` (caller must be an admin of the org; unknown org
  indistinguishable from non-admin), GET/QUERY-only, JSON-LD-only contract
  (pinned `Accept`, upstream content-type guard — no binary), and
  safe-by-grant upstream authorization (the org's credentials only succeed
  where the org holds a data grant) — are documented in the OpenWiki
  `services/org-context.md`.

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
| `revoke-delegation-chain.md` 🔶 | `GrantRevocationHandler` + `AccessRevocation` dispatch on the delegation endpoint (`GrantIssuanceRouter`), and the `RevokeGrants` RPC (`services/Revocation.ts` via `ApiHandler`) |
| `webhook-subscription-bootstrap.md` ⬜ | Reuses the existing `ActivityWebhookStore` + the **stock** CSS notification API (`SubscriptionClient` → `WebhookChannel2023`, kv-backed `KeyValueChannelStorage`) — no new components |

### No CSS components needed

Everything else — `authorization-revoked`, `check-equivalence`,
`revoke-delegation-chain-follow-ups`, `components-tweaks`,
`specific-instance-access-requests`, `generic-auditing` — runs in the Temporal
worker, the services layer, or data-model; they neither override nor extend the
CSS server configuration.
