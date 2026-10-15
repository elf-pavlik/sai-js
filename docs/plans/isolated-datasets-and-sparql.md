# Isolated datasets + SPARQL — per-pod cutover

> **Status:** extracted from phase 4 of `org-context-sparql.md` (phases 1–3
> there are landed: dormant mirror writer ✅, SPARQL read plane ✅,
> context/session fix — in flight). This plan is **not started** (design
> only). 4a ends green-everywhere; 4b is a **joint checkpoint** with the
> maintainer (dagger harness changes are user-side).
>
> **Environment realization:** the concrete Oxigraph → Fuseki swap, the
> per-pod fixture split, the CSS `PodEndpointStore` (typed SPARQL + object/S3
> records) +
> `RoutedSparqlDataAccessor`, and the `kv.json` seeds are realized in
> [`fuseki-per-pod-sparql.md`](fuseki-per-pod-sparql.md). That plan stages
> this one's 4a/4b across three green stages; read it alongside 4b. It also
> **widens the isolation unit from the owner to the pod** (registry pod +
> each data pod), per the maintainer decision.
>
> Prerequisites (already landed in `org-context-sparql.md`):
> - **Phase 1** — dormant mirror writer (`ReciprocalMirror.ts` +
>   `syncReciprocalMirror`/`deleteReciprocalMirror` activities); call sites
>   commented out, env var + `sparql` service binding already present in
>   `.dagger/src/index.ts`;
> - **Phase 2** — org-context peer-data reads on SPARQL, parametrized by
>   **resource IRI** (`GRAPH <iri>` UNION `meta:<iri>`); gated
>   `/sparql-admin` (HTTP `QUERY`);
> - **Phases 2–3 reads** currently resolve against the **shared store**
>   (`federation.md` shortcut 1) — the same queries resolve to mirror graphs
>   unchanged once stores split (the reason every query is IRI-parametrized).

## Problem

Everything before this phase works because one shared triple store holds
**every** agent's graphs (registry + data servers point at the same
endpoint — `federation.md` shortcut 1). That is a single-deployment
artifact: the moment stores split per pod:

- cross-pod reads die — the org's endpoint no longer contains the peers'
  graphs phase-2/3 reads hit (`GRAPH <peerIri>`) nor its own other pods'
  graphs;
- the **phase-1 reciprocal mirrors become load-bearing**: the org's store
  contains nothing about peers except what the org mirrored, so
  `syncReciprocalMirror` must be active **before** cutover, and the local
  mirror graphs (named after the source resource IRIs) become the only
  source for peer-data reads;
- `/sparql-admin` must forward into the **org's own** dataset (it currently
  forwards to the global endpoint — the §2.2 known limitation: the gate
  restricts *who*, not *which graphs*).

`federation.md` shortcut 1a documents this: mirroring "is not an
optimization but the **only** source for those reads" once per-pod stores
exist.

## Phase 4a — Endpoint registry (green everywhere)

Per-pod endpoint addresses in `AccountLoginStorage` — the
`ReciprocalWebhookStore` pattern (`RECIPROCAL_WEBHOOK_STORAGE_TYPE`):

```
type 'sparqlEndpoint' = { accountId, podUrl: string, endpoint: string }
type 'objectEndpoint'  = { accountId, podUrl: string, endpoint: string,
                          bucket: string, accessKeyId: string, secretAccessKey: string }
```

(`fuseki-per-pod-sparql.md` realizes this as the typed `PodEndpointStore`: one
record per pod — the owner's registry pod and every data pod, each with its
**own** endpoint, plus an **object (S3)** record for data pods — so the
data-plane accessor and the permission engine can look the right dataset up
from a pod base URL. Endpoints are keyed by `podUrl`; the owner is reached
indirectly through the account (`accountId`), so no `webId` is stored.)

- provisioned at account bootstrap (`services/Account.ts`): mint one registry
  pod dataset + one data pod dataset, each with an endpoint record;
- `SessionManager.getSession(webId)` resolves the owner's **registry-pod**
  record, hands each AA its own internal endpoint (the phase-2 `sparqlEndpoint`
  AA field); a missing record **fails closed** (no env-var fallback);
- migrate direct consumers (`SaiPermissionsEngine`,
  `SaiAuthorizationManager`, `GrantRevocationHandler`) to looked-up endpoints —
  the data server resolves the storage owner's **registry pod** for grant reads;
- Package vitest: endpoint-record CRUD, bootstrap wiring.

## Phase 4b — Per-pod store cutover (joint checkpoint)

Prerequisite checklist before flipping environments:

- [ ] **mirrors wired and backfilled** for all existing reciprocals;
      re-enabling = uncommenting the two disabled call sites
      (`ActivityWebhookHandler` `delegatedGrantsUpdated` fan-out +
      `establishReciprocal` initial-mirror step) — code-only (worker env var
      + `sparql` service binding already in `.dagger/src/index.ts`). The
      mirror write deliberately lives ONLY at those workflow-orchestration
      sites — never inside the `reciprocalRegistration` discovery activity
      (cross-graph queries die once stores split);
- [ ] **backfill tooling** for registrations that predate the mirror (drift
      scan: reciprocal-linked registrations whose mirror graph is missing);
- [ ] mirror syncs **serialized per (webId, peerId)**: deterministic
      workflowId with start-or-absorb (grantee-consumer pattern) — random
      workflowIds today allow two syncs for the same reciprocal to race, and
      a stale-diff drop could remove a graph a concurrent newer sync just
      re-linked;
- [ ] `/sparql-admin` forwards into the **org's own store** — closes the
      global-graph caveat (§2.2 of `org-context-sparql.md`);
- [ ] **external discovery** for admins, mirroring C2's mechanism:
      `AgentIdHandler` exposes the org's admin-endpoint IRI to admins
      (third `Link` header with new rel, e.g. `hasSparqlEndpoint`, or a
      field in the agent-id document body next to
      `hasDelegationIssuanceEndpoint` — term naming tbd); AA resolves +
      caches it like `getRegistrySet`; `ResolvedContext` carries it (the
      org-context reads in phase 3 pick it up for peer/mirror queries);
- [ ] **unregister mirror deletion** flow (Temporal workflow with
      `deleteReciprocalMirror` as one compensable step — the activity
      already exists in `temporal/activities/reciprocal.ts`).

Environment work (user-side): per-pod Fuseki datasets + config in
`environments/css`, seed loading per pod, `setup.ts`/`kv.json` updates. The
global env var has been dropped. The concrete shape of this work (one Fuseki
dataset per registry pod and per data pod + a dedicated `id` dataset, fixture
splitting, routed accessor) is [`fuseki-per-pod-sparql.md`](fuseki-per-pod-sparql.md)
stage 3.

### Tests

- `/test` (user-run): cross-pod isolation — Dan querying Alice's
  endpoint → 403 by gate; Dan's queries never see Alice graphs even at his
  own endpoint; org-context flows green end-to-end against per-pod
  stores; mirror freshness e2e (peer update → webhook → `waitFor` → view
  reflects; unregister → mirror deleted).
- Package vitest: endpoint-record CRUD, bootstrap wiring (4a).

## Decided

- Endpoint-per-pod addresses in `AccountLoginStorage` (registry pod + each
  data pod, own dataset each); external admin discovery mirrors the
  `hasRegistrySet` mechanism.
- `/sparql-admin` forwards into the org's own **registry pod** at 4b (closes
  the who-not-which-graphs caveat); org-context reads at the per-pod split
  authenticate as the **admin** — the org itself keeps using its own
  internal endpoint for its own registry.
- Mirrors activated only at the workflow-orchestration call sites; syncs
  serialized per (webId, peerId); unregister deletion is a compensable
  Temporal workflow step.
- Phase-2/3 queries are IRI-parametrized (`GRAPH <iri>` UNION `meta:<iri>`)
  so the cutover needs **zero query changes** — they resolve to mirror
  graphs inside the org's own dataset.

## Open items

- rel term / doc field name for endpoint discovery (vocab addition).
- Mirror staleness policy (re-poll on webhook gap?) and initial backfill
  tooling for existing registrations — **a 4b prerequisite only**; phases
  2–3 do not depend on mirrors being populated. Note: the `done` status of
  a `delegatedGrantsUpdated` activity reflects grant regeneration only —
  the parallel mirror-sync workflow retries independently. **Decided:**
  when `reconcileActivities` is scheduled (currently never scheduled —
  Phase 4.2), its `delegatedGrantsUpdated` branch also re-runs
  `syncReciprocalMirror` for the failed-mirror case, plus a drift-scan arm
  (reciprocal-linked registrations whose mirror graph is missing) as the
  durable backstop beyond activity retries.
- Whether peer-instance content listing ever enters org-context scope
  (currently no; mirrors cover registry metadata only) — linked to the
  §2.4 known issue in `org-context-sparql.md`.