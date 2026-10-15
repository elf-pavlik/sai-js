# Fuseki migration + per-pod SPARQL endpoints

> **Status:** Stages 1–3 ✅ landed **and integration-hardened** (Fuseki
> drop-in + per-pod endpoint registry + per-pod datasets / fixture split /
> routed accessor / permission-engine + mirror activation; plus the
> session/context allowlist, the Fuseki `INSERT DATA` mirror-write fix, and the
> `PostgresKeyValueStorage.entries` fix surfaced by `/test`). Remaining 4b
> follow-ups are listed in Stage 3 / Open items.
> Environment-touching (dev compose +
> dagger) and code-touching (components). This is the concrete
> **infrastructure realization of phases 4a/4b** in
> [`isolated-datasets-and-sparql.md`](isolated-datasets-and-sparql.md), with one
> correction to its 4a wording: the isolation unit is **the pod**, not the
> owner. This plan covers the **Oxigraph → Fuseki** swap, the **per-pod split of
> the big fixture** (`environments/data/registry.trig`), the **CSS
> storage/routing customization** that stores and uses one endpoint per pod,
> and the seed/`kv.json` updates. The user side owns `/test` and the dagger
> harness.
>
> **Prerequisites** (both already landed or tracked elsewhere):
> - `isolated-datasets-and-sparql.md` **4a** — endpoint records in
>   `AccountLoginStorage`, `SessionManager` lookup, env-var fallback (this plan
>   widens the record to per-pod).
> - `federation.md` **shortcut 1a** — reciprocal mirrors are the *only* source
>   for peer data once stores split. **The store split cannot land before
>   mirrors are wired** (see [Sequencing](#sequencing)).

## Problem

Today every CSS server (auth, registry, data) and the `id` service point at
**one** Oxigraph instance behind an nginx facade
(`environments/css/oxigraph.nginx.conf`), and the whole fixture
(`environments/data/registry.trig`) is POSTed to it as a single dataset
(`test/setup.ts:104`, `packages/repl/cmd.ts` `seed-env`). This is
`federation.md` shortcut 1: every graph of every pod is visible from the one
endpoint. Nothing enforces per-pod isolation, and `/$/sparql-admin`,
`SaiAuthorizationManager.getAuthorizationData`, and the AA's registry-plane
reads all silently rely on the shared store.

To isolate, we need:

1. a store that can host **one dataset (endpoint) per pod** and that speaks the
   standard SPARQL 1.1 + Graph Store protocols CSS and `fetch-sparql-endpoint`
   already use;
2. a **split of the fixture** so each registry pod's graphs and each data pod's
   graphs land in their own datasets;
3. a **CSS customization that stores the per-pod endpoint** and storage/permission
   code that **resolves and routes to the right dataset** — the LDP write path
   *and* the permission engine's grant lookup, not just the AA's read plane;
4. seeds (`kv.json`) that carry the endpoint records for the pre-seeded pods;
5. **provisioning on account creation**: mint one registry pod + one data pod,
   each with its own dataset/endpoint.

## Scope / non-goals

**In scope** (dev compose + dagger test): the store swap, per-pod fixture split,
CSS endpoint store + routing accessor + permission-engine resolution,
`Account.ts` bootstrap (create both datasets + records), `kv.json` seeds,
`test/setup.ts` + `packages/repl` seeding, and the docs/index updates.

**Out of scope** (follow-ups, explicitly flagged):
- the **production** Nix images and NixOS/podman deployment
  (`nix/images/sai-oxigraph.nix`, `nix/podman.nix`, `flake.nix`,
  `.github/workflows/oci.yml`) — `production-consumer-cleanup.md` territory;
- **separate S3 bucket per data pod** — a separate plan (user-side note);
- **mirror activation** (4b workflow uncommenting, backfill) — owned by
  `isolated-datasets-and-sparql.md`;
- **external admin-endpoint discovery** (4b `hasSparqlEndpoint` link) — 4b.

## Decision — the isolation unit is the pod

Each **registry pod** (a registry set) and each **data pod** (a data storage)
gets its **own Fuseki dataset and endpoint**. An account owns exactly one
registry pod and one-or-more data pods:

- 6 registry pods in the fixture (acme, yoyo, alice, bob, kim, dan);
- 11 data pods (acme-rnd/hr, yoyo-eu/na, alice-home/work, bob, kim-red/blue,
  dan-east/west).

**Consequence that shapes the rest of the plan:** a data pod's dataset no longer
contains its owner's grants. Grants live in the owner's **registry pod** dataset.
So every consumer that used the single store must resolve an endpoint:

| Consumer | Endpoint it needs |
|---|---|
| AA session (`SessionManager.getSession(webId)`) | owner's **registry pod** |
| `RoutedSparqlDataAccessor` on the **data** server | the specific **data pod** of the resource |
| `RoutedSparqlDataAccessor` on the **registry** server | the **registry pod** of the handle |
| `SaiAuthorizationManager` / `SaiPermissionsEngine` (data server) | the storage owner's **registry pod** (grant lookup) |
| `/sparql-admin` | the org's **registry pod** |
| `services/id` | `shared` (public WebID profiles — see below) |

A small **`shared`** dataset holds genuinely cross-pod/public graphs:
`<https://registry/>` (root `ldp:contains` index), `<https://data/shapetrees/>*`
(shape trees/shapes), `<https://data/test-client/>*` (app client-id doc), and
`<https://id/>*` (public WebID profiles — the `id` service is a single service
and keeps its current single-endpoint behavior). Privacy note: the root registry
index leaks handles; it is already world-readable today and is not part of the
4b isolation claim. (Option: move `id/<handle>` into the owner's registry pod;
that would require per-handle endpoint resolution in the `id` service — not
needed for isolation since profiles are public.)

## Decision — Fuseki topology, distribution, and endpoints

Apache Jena Fuseki ([admin protocol](https://jena.apache.org/documentation/fuseki2/fuseki-server-protocol.html),
[config](https://jena.apache.org/documentation/fuseki2/fuseki-configuration.html)):

- **One Fuseki server, N TDB2 datasets** (one per registry pod, one per data pod,
  plus `shared`), declared in a `config.ttl` (`fuseki:Service` per dataset).
  Endpoints per dataset `ds`:
  - `/{ds}/sparql` — SPARQL query **and** update (CSS's single-endpoint
    assumption holds; the content-type nginx mapping is no longer needed);
  - `/{ds}/data` — Graph Store Protocol read/write (`?graph=<iri>` or default);
  - optionally `/{ds}/get` — GSP read-only.
- **Distribution = Fuseki Full (webapp), not Fuseki Main.** Fuseki2 *does* have
  the admin protocol (`/$/ping`, `POST /$/datasets?dbType=tdb2&dbName=…`,
  `DELETE /$/datasets/{name}`, `/$/tasks`, …) — but **Fuseki Main** (the plain
  `jena-fuseki-server` jar, and the official `jena-fuseki-docker` kit built on
  it) "does not provide the Fuseki UI or admins functions to create dataset via
  HTTP". Fuseki Full includes it. We need Full so account bootstrap can create
  datasets dynamically.
- **Shiro service account** (`FUSEKI_BASE/shiro.ini`): by default `/$/** =
  localhost` and `/**=anon`; replace with
  ```ini
  [users]
  sai-service=<hashed>,admins
  [urls]
  /$/ping = anon
  /$/server = anon
  /$/** = authcBasic,roles[admins]
  /**=anon
  ```
  so the auth server can call `POST /$/datasets` remotely. Dataset creation
  persists in `FUSEKI_BASE`, so it survives restarts.
- **dev/test bootstrap**: a generated `config.ttl` pre-declares the fixture's 6
  registry + 11 data pods + `shared` (deterministic, no admin calls needed at
  seed time). Dynamic `/$/datasets` is used for *new* accounts.
- **Image**: add `nix/images/sai-fuseki.nix` (pattern: `sai-oxigraph.nix`)
  wrapping the Fuseki **Full** distribution + generated config + `shiro.ini`,
  and add `sai-fuseki-image` to `flake.nix` + `.github/workflows/oci.yml`.
  Compose and dagger use the same pinned image so protocol behavior is
  identical. (Community full-Fuseki images are an acceptable stand-in for local
  dev if the Nix build lands later.)
- **Default-graph semantics**: TDB2 keeps the default graph separate from named
  graphs. CSS's `SparqlDataAccessor` and every SAI query address **named**
  graphs (`GRAPH <…>` / `meta:`), so no `tdb2:unionDefaultGraph` is needed — but
  the seeding helper must load named graphs explicitly (below), verified in
  stage 1.

## Decision — seeding the big fixture per pod

Do **not** hand-edit `environments/data/registry.trig` (4627 lines). Split it at
load time:

- `podForGraph(graphIri)` — map a graph IRI to a dataset:
  - strip a leading `meta:`;
  - `https://registry/<handle>/…` → registry pod `reg-<handle>`;
  - `https://data/<pod-base>/…` → data pod `data-<pod-base>`;
  - `<https://registry/>`, `<https://data/shapetrees/…>`,
    `<https://data/test-client/…>`, `https://id/<handle>` → `shared`.
- parse the TriG into quads (`n3` is already a dependency of
  `interop-test-utils` and `components`) and group by graph;
- for each dataset: clear it and load its graphs.
  - **Clear**: SPARQL `DROP ALL` (verified) — Fuseki's GSP `DELETE /{ds}/data`
    only clears the default graph, so `seedQuadstore`'s Oxigraph
    `DELETE <endpoint>` cannot be reused as-is.
  - **Load**: a **single** `POST /{ds}/data` with `Content-Type:
    application/trig` loads the payload's named graphs verbatim (verified
    against `secoresearch/fuseki:5.6.0` — `quadCount` matches). One request per
    graph (`POST /{ds}/data?graph=<graphIRI>`) is the fallback.

New helper in `packages/test-utils` (e.g. `src/fuseki.ts`), shared by
`test/setup.ts` and `packages/repl/cmd.ts`:

```ts
// sketch — actual API to be pinned with the implementation
export interface FusekiPodSeed { dataset: string; endpoint: string; graphs: string[] }
export function splitFixtureByPod(trig: string, map: PodGraphMap): FusekiPodSeed[]
export async function seedFusekiPods(base: string, seeds: FusekiPodSeed[]): Promise<void>
```

`test/setup.ts` then seeds every pod dataset in `beforeEach` (replacing the
single `seedQuadstore('http://sparql/store', datasetData)`), and
`packages/repl` `seed-env` seeds `${base}` in the dev compose network (replacing
`http://localhost:7878/store`).

## Decision — CSS stores one endpoint record per pod, and routes by it

### 1. `SparqlEndpointStore` (the record)

New class modelled on
[`ReciprocalWebhookStore.ts`](../../packages/components/src/ReciprocalWebhookStore.ts),
backed by the same `AccountLoginStorage`:

```ts
export const SPARQL_ENDPOINT_STORAGE_TYPE = 'sparqlEndpoint'
export const SPARQL_ENDPOINT_STORAGE_DESCRIPTION = {
  accountId: `id:${ACCOUNT_TYPE}`,
  webId: 'string',       // owner (org or personal) — enumeration/cleanup
  podUrl: 'string',      // registry-set IRI or data pod base URL
  endpoint: 'string',    // e.g. http://fuseki:3030/reg-<handle>/sparql
} as const
```

Keyed by **pod URL**: a registry pod's URL is its registry-set IRI
(`https://<regOrigin>/<handle>/`), a data pod's is its storage base URL. The
registry-set IRI is exactly what `registryId(webId)` derives, so every caller
can produce the pod URL — no `kind` discriminator is needed:

- indexes on `webId` and `podUrl` (`accountId` is the parent, indexed
  automatically);
- `findByPodUrl(podUrl)` → that pod's endpoint (the single resolver: AA session,
  data accessor, permission engine, `/sparql-admin`);
- `findByIri(iri)` → the record whose `podUrl` is the longest prefix of `iri`
  (resolves a registry resource like `…/grant/<id>` to its registry pod — used
  by the delegation/revocation handlers);
- `findByWebId(webId)` → all pods of the owner (enumeration/cleanup);
- `create({ accountId, webId, podUrl, endpoint })` / `delete`.

Wired in `packages/components/config/storage/account.json` alongside the other
stores, and added to `PrimaryParallelInitializer` /
`EarlyProcessParallelInitializer`. Exported from
`packages/components/src/index.ts` for `componentsjs-generator`.

### 2. `Account.ts` bootstrap creates both pods and their endpoints

`packages/components/src/services/Account.ts:bootstrapAccount` currently writes
the pod/owner/webIdLink records directly into the account's kv blob and POSTs
one `trigDataset`. Extend it to:

1. create **two** Fuseki datasets via the admin API:
   `POST ${fusekiAdmin}/$/datasets?dbType=tdb2&dbName=reg-<handle>` and
   `…&dbName=data-<handle>` (idempotent: treat "already exists" as success);
2. split its `trigDataset`: `webIdTemplate` + `registrySetTemplate` →
   `reg-<handle>`; `dataRegistryTemplate` → `data-<handle>`;
   POST each to `/{ds}/data`;
3. write two `**sparqlEndpoint**` records + index entries (podUrl = the
   registry-set IRI and the data pod base URL).

New `AccountService` constructor args (config
`packages/components/config/services/account.json`): a Fuseki **admin/base** URL
(`urn:sai:default:variable:fusekiBaseUrl`, e.g. `http://fuseki:3030`) and the
service credentials; the existing `sparqlEndpoint` var stays as the
fallback/shared endpoint.

### 3. `SessionManager` resolves the owner's registry pod and builds the allowlist

`packages/components/src/SessionManager.ts` gets the `SparqlEndpointStore`
injected (constructor arg) and, in `getSession(webid, registrySetId?)`, loads
**all** of the owner's records (`findByWebId(webid)`) into an allowlist
`sparqlEndpoints: Map<podUrl, endpoint>`. The registry endpoint is
`sparqlEndpoints.get(registrySetId ?? registryId(webid))`, falling back to the
env-var endpoint. Both `sparqlEndpoint` and `sparqlEndpoints` are passed to
`AuthorizationAgent.build(…, { sparqlEndpoint, sparqlEndpoints })` (4a widened
to the allowlist — see §6). Both construction paths must pass the store:

- config instance `urn:sai:default:SessionManager` in
  `packages/components/config/http/handler/default.json`;
- `packages/components/src/builders/sessionManager.ts:buildSessionManager()`
  (used by Temporal activities) — build the store via
  `buildAccountLoginStorage()` (pattern in `temporal/activities/reciprocal.ts`).

### 4. Routed accessor — the LDP write path isolates too ✅

The AA read plane is not enough: the CSS **LDP storage** writes pod resources
through `SparqlDataAccessor`, constructed with **one** endpoint
(`css:config/storage/backend/data-accessors/sparql-endpoint.json`,
`urn:solid-server:default:variable:sparqlEndpoint`). Add a custom
`RoutedSparqlDataAccessor` (implements `DataAccessor`, same surface as
`HybridDataAccessor`'s `sparqlAccessor`) that resolves an endpoint per
identifier and delegates to a cached per-endpoint `SparqlDataAccessor`
(`Map<endpoint, SparqlDataAccessor>`, same `IdentifierStrategy`):

- **data server**: `podStore.findByBaseUrl(identifier.path)` → the pod base URL
  → `findByPodUrl(podBase)`;
- **registry server**: first path segment `<handle>` → registry pod URL
  `${CSS_BASE_URL}${handle}/` → `findByPodUrl(...)` (no `idOrigin` needed — the
  registry server's own base URL *is* the registry origin);
- fall back to the env endpoint when unresolved (stage 2).

Replace `urn:solid-server:default:SparqlDataAccessor` with it via the Override
in `packages/components/config/storage/routed-sparql.json` (imported by both
`registry.json` and `data.json`); `sparql-endpoints.json` adds the
`SparqlEndpointStore` to those servers' initializers.

### 5. Permission engine resolves the data owner's registry pod ✅

`SaiAuthorizationManager.getAuthorizationData` / `SaiPermissionsEngine` collect
grants with `GRAPH ?g { ?s interop:hasStorage <storage> }`. With per-pod
datasets the grants are **not** in the data pod's dataset. Before the query,
resolve the storage owner (as in §4 data server) → `registryId(owner)` →
`findByPodUrl(...)` → run the grant query against that endpoint. `SaiPermissionsEngine`
resolves the **resource's data pod** for the inheritance query. Same lookup for
`GrantIssuanceHandler.validateDelegable` and `GrantRevocationHandler` (via
`findByIri(grantIri)`, since the owner is read off the grant IRIs).

### 6. Session/context endpoint allowlist (isolation) ✅

The session may only query the pods recorded for its owner in the internal
account storage — never another owner's dataset:

- `AuthorizationAgent` holds `sparqlEndpoints: Map<podUrl, endpoint>` and exposes
  `resolveEndpoint(iri)` (longest pod-URL prefix) and `sparqlTransportFor(iri)`
  (**throws** when the IRI is not under an allowed pod).
- `ResolvedContext.endpoints` is the context allowlist: personal =
  `session.sparqlEndpoints`; org = `findByWebId(ctx.webId)` (the **org's**
  records) after the `requireOrgAdmin` gate. `resolveContext(userSession,
  context, endpointStore)` builds it.
- `sparqlTransportForPod(ctx, podUrl)`: personal → `session.sparqlTransportFor`;
  org → `adminSparqlTransport(session, orgWebId, podUrl)`.
- `AdminSparqlHandler` accepts `?pod=<podUrl>` and resolves it **only if
  `record.webId === orgWebId`** (403 otherwise).
- The data-plane reads use the allowlist, not `registrySet.hasDataRegistry`:
  `findUserDataRegistrations` iterates `ctx.endpoints`;
  `generateSourceDataGrants` iterates the owner's data pods (allowlist minus the
  registry pod); `dataRegistrationContains` reads the resource's pod.

> **Alternative topology (not chosen):** one Fuseki container per pod plus an
> nginx router. It yields stronger fault isolation but still needs the same
> routing/resolution code (the resolver is what picks the per-pod URL), so it
> buys only physical separation at the cost of N containers and N configs.
> Revisit only if per-pod robustness becomes a requirement.

## `environments/data/kv.json` seeds

For each pre-seeded pod add, inside `accounts/data/<id>`:

```jsonc
"**sparqlEndpoint**": {
  "<uuid>": { "accountId": "<id>", "webId": "https://id/<handle>",
              "podUrl": "https://registry/<handle>/",
              "endpoint": "http://fuseki:3030/reg-<handle>/sparql" },
  "<uuid2>": { "accountId": "<id>", "webId": "https://id/<handle>",
               "podUrl": "https://data/<pod>/",
               "endpoint": "http://fuseki:3030/data-<pod>/sparql" }
},
```

one record per registry pod (6) and per data pod (**13** — the account pods
plus `data/shapetrees` and `data/test-client`, both `dataOwner <https://id/acme>`
in the fixture's public grants), plus matching
`accounts/index/sparqlEndpoint/<uuid>`, `.../webId/<encoded>` and
`.../podUrl/<encoded>` entries.
The endpoint host is the internal service name (`fuseki`), so the existing
`generateRegistry` url-substitution for dev/demo does **not** rewrite it (not a
public origin; `map.json` should not gain these). Verify `packages/repl`
`generate-registry`/`seed-env` still round-trip the file.

**Reciprocal webhooks (both directions).** The mirror is load-bearing once
stores split, so every reciprocal pair needs **both** subscription directions
(the watcher side's `**reciprocalWebhook**` record + its `WebhookChannel2023`
channel + `notifications/*` records + indexes). The fixture originally seeded
only one direction (alice's); the plan's environment work completed them to
**16 webhooks** covering all 8 pairs (`alice↔acme`, `alice↔bob`, `alice↔kim`,
`bob↔acme`, `bob↔dan`, `bob↔yoyo`, `kim↔yoyo`, `yoyo↔dan`). Without this, a
grantor's registration update never reaches the grantee's mirror and the
grantee's SPARQL reads (which resolve against its own pods) come back empty.

## Public surfaces that keep working (or must change)

| Surface | Current | After |
|---|---|---|
| AA session reads | `session.sparqlEndpoint` = one env endpoint | owner's **registry pod** endpoint (fallback retained) |
| `SaiAuthorizationManager` / `SaiPermissionsEngine` / `GrantIssuanceHandler` / `GrantRevocationHandler` / `ApiHandler` / `AdminSparqlHandler` | config-bound `urn:solid-server:default:variable:sparqlEndpoint` | resolve the storage owner's **registry pod** (stage 3) |
| `/sparql-admin` | forwards to the global endpoint | forwards into the org's **registry pod**; `?pod=<podUrl>` targets another of the org's pods (ownership-checked) |
| `services/id` (`CONSTRUCT <https://id/<handle>>`) | single endpoint | unchanged — WebID profiles live in `shared` |
| `SparqlDataAccessor` (registry + data) | single endpoint | `RoutedSparqlDataAccessor` |
| Temporal mirror activities (`syncReciprocalMirror` etc.) | `process.env.CSS_SPARQL_ENDPOINT` (`reciprocal.ts:149`) | `session.sparqlEndpoint` (owner's registry pod) |

## Integration hardening (surfaced by `/test`)

Fixes required to make the split green end-to-end (each landed):

- **AA data-plane reads** (`components/src/services/Authorization.ts`):
  `findUserDataRegistrations` / `generateSourceDataGrants` read data
  registrations from the context's pods (allowlist), not `registrySet`.
- **`PostgresKeyValueStorage.entries`** (first caller = `findByIri`):
  `postgres@3.x` cursors expose no `.close()` and yield **batches of row
  objects** (`{ key, value }`), not `[key, value]` tuples.
- **Fuseki `INSERT DATA`**: `updateReciprocalMirror` must emit
  `GRAPH <g> { <triples> }` blocks — 4-term N-Quads lines are invalid in
  Fuseki (Oxigraph accepted them).
- **Mirror write target**: `syncReciprocalMirror` / `deleteReciprocalMirror`
  write to `session.sparqlEndpoint` (the owner's registry pod), not the env
  endpoint.
- **Data-server origins**: CSS maps `CSS_*` env vars to CLI args, so the data
  server needs the `idOrigin`/`docOrigin`/`dataOrigin`/`regOrigin` options
  declared (`sai:config/variables/origins.json`, imported by `data.json`) for
  `registryId()` to work there.
- **Test-process store**: `buildSessionManager()`'s lazy endpoint store reads
  `CSS_POSTGRES_CONNECTION_STRING`; set it in `test/setup.ts` and the dagger
  `testBase`.
- **shapetrees / test-client as pods**: modelled as acme-owned data pods (the
  fixture's public grants name `dataOwner <https://id/acme>`), so the engine
  resolves their owner via `podStore` instead of fanning out.

## Sequencing

This must be landed as **three observable-green stages**, because a big-bang
per-pod split requires the 4b mirrors to already be live.

### Stage 1 — Oxigraph → Fuseki, one `shared` dataset (no behavior change) ✅

Landed:

- `environments/css/fuseki.config.ttl` — one `fuseki:Service` `shared`
  (`tdb2:DatasetTDB2`), endpoints `/shared/sparql` (query + update) and
  `/shared/data` (GSP).
- `docker-compose.yaml` — `oxigraph` + the nginx `sparql` facade replaced by a
  `fuseki` service (`secoresearch/fuseki:5.6.0`, `--conf /tmp/fuseki.config.ttl`,
  host port `3030`); `x-sparql-env` → `http://fuseki:3030/shared/sparql`; `id`
  `depends_on` → `fuseki`; `environments/css/oxigraph.nginx.conf` deleted.
- `.dagger/src/index.ts` — `oxigraphService`/`sparqlService` → `fusekiService`
  (entrypoint kept, `FusekiServerCmd --conf`), `CSS_SPARQL_ENDPOINT` updated,
  `fuseki` bound into worker/id/auth/registry/data/testBase.
- `packages/test-utils/src/env.ts` — `seedQuadstore`/`dropQuadstore`/
  `fetchQuadstore` replaced by `seedFusekiDataset`/`dropFusekiDataset`
  (`DROP ALL` + one TriG GSP POST).
- `test/setup.ts` + `packages/repl/cmd.ts` `seed-env` use the new helpers.

Verified locally against `secoresearch/fuseki:5.6.0`: query+update on
`/shared/sparql`, GSP on `/shared/data`, `/$/datasets` (admin module present),
idempotent re-seed, and the full fixture (472 graphs / 2368 triples) loads.

**Gotcha fixed during Stage 1:** Fuseki listens on **3030**, whereas the old
nginx `sparql` facade listened on 80. `CSS_SPARQL_ENDPOINT` must therefore
include the port (`http://fuseki:3030/shared/sparql`); a bare
`http://fuseki/shared/sparql` fails with `fetch failed` (connection refused on
80) during CSS startup (`SparqlDataAccessor`'s version CONSTRUCT). Reproduced in
compose (registry/data restart-loop) and verified fixed in both compose and the
dagger module (Dagger health-checks the exposed 3030 port before starting
clients).

**Exit:** the whole `/test` suite green on Fuseki (user-run). No component
change yet.

### Stage 2 — Per-pod endpoint registry (4a widened) with a single dataset ✅

Landed (records still point at the shared dataset — no behavior change):

- `packages/components/src/SparqlEndpointStore.ts` — AccountLoginStorage type
  `sparqlEndpoint` (`accountId`/`webId`/`podUrl`/`endpoint`, indexes on
  `webId`/`podUrl`), `create`/`findByPodUrl`/`findByWebId`/`delete`; wired into
  `config/storage/account.json`
  (both parallel initializers) and exported for the generator.
- `Account.ts` bootstrap writes one **registry** record (`podUrl` = registry
  set) and one **data** record (`podUrl` = data registry) with the current
  `sparqlEndpoint`, plus the `accounts/index/sparqlEndpoint/*` entries.
- `SessionManager` resolves the owner's registry-pod record, falling back to
  the env endpoint; the store is injected via config on the auth server and
  built lazily (`buildAccountLoginStorage`) in the worker/test builder so no
  `buildSessionManager()` call sites change.
- `environments/data/kv.json` carries 6 registry + 11 data records (all
  `http://fuseki:3030/shared/sparql`) + 40 index entries, generated
  programmatically (not hand-edited).
- Package vitest: store CRUD/resolution + `AccountService` bootstrap wiring.

**Deferred to Stage 3:** `RoutedSparqlDataAccessor` and the permission-engine
endpoint lookup. With every record pointing at `shared`, routing is a no-op, so
landing the accessor now would add config/`PodStore`-injection risk for zero
behavior change; it moves to Stage 3 where the records diverge.

**Exit:** auth/registry/data start in compose with the new config; package
vitest green (73 files). Full `/test` suite is the user-run confirmation.

### Stage 3 — Per-pod datasets + fixture split (4b environment work) ✅

Landed:

- `environments/css/fuseki.config.ttl` — generated, **20 datasets** (`shared` +
  6 `reg-<handle>` + 13 `data-<pod>`) via `packages/test-utils/src/fuseki.ts`
  (`fusekiConfig`).
- **Fixture split + mirror backfill** (`splitFixtureByPod`): routes each graph
  to its pod dataset and copies each reciprocal target (+ its grants) into the
  linking owner's dataset — the offline equivalent of `updateReciprocalMirror`.
- `test/setup.ts` + `packages/repl` `seed-env` seed every per-pod dataset.
- `environments/data/kv.json` endpoint records flipped to per-pod URLs
  (`http://fuseki:3030/reg-<handle>/sparql`, `.../data-<pod>/sparql`).
- `Account.ts` creates the two datasets (admin API, `CSS_FUSEKI_ADMIN`) and
  POSTs the bootstrap TriG per dataset (WebID profile stays in `shared`).
- **`RoutedSparqlDataAccessor`** (new) — `StorageLocationStrategy` → pod URL →
  `findByPodUrl`; replaces CSS's single-endpoint accessor on registry + data.
- **Permission engine** — `SaiAuthorizationManager` resolves the storage
  owner's registry-pod endpoint for grants; `SaiPermissionsEngine` resolves the
  resource's data-pod endpoint for the inheritance query.
- **`/sparql-admin`** forwards into the org's registry pod (and `?pod=<podUrl>`
  into another of the org's pods, ownership-checked).
- **Mirrors activated** — initial mirror in `establishReciprocal`; webhook
  `delegatedGrantsUpdated` fan-out starts `syncReciprocalMirror` with a
  deterministic `mirror:<webId>:<peerId>` workflowId (start-or-absorb).
- **Session/context allowlist** (§6) + the integration hardening below.

Verified: 73 package test files / 310 tests; compose auth+registry+data start
with the routed accessor, the store initializer, the origins config, and the
engine changes.

**Remaining 4b follow-ups (separate plans/flows):** live-registration backfill
workflow (the fixture is backfilled at seed time), unregister mirror deletion
(no unregister flow exists yet), external admin-endpoint discovery
(`hasSparqlEndpoint` link), and the production Nix image/config swap.

## Files

| Area | File(s) |
|---|---|
| Store image/config | `nix/images/sai-oxigraph.nix` → `nix/images/sai-fuseki.nix` (Fuseki Full); `flake.nix`; `.github/workflows/oci.yml`; `environments/css/oxigraph.nginx.conf` → `environments/css/fuseki.config.ttl` + `shiro.ini` |
| Dev env | `docker-compose.yaml` (`oxigraph`, `sparql`, `x-sparql-env`, `depends_on`, `id`/`registry`/`data`/`worker`) |
| Test env | `.dagger/src/index.ts` (`oxigraphService`, `sparqlService`, `CSS_SPARQL_ENDPOINT`, bindings) |
| Seeds | `packages/test-utils/src/env.ts` (+ new `fuseki.ts`), `test/setup.ts`, `packages/repl/cmd.ts`, `environments/data/kv.json`, `environments/data/registry.trig` (unchanged source) |
| CSS store | `packages/components/src/SparqlEndpointStore.ts` (new), `packages/components/src/index.ts`, `packages/components/config/storage/account.json`, `packages/components/config/services/account.json`, `packages/components/config/variables/origins.json` (data server) |
| CSS routing | `packages/components/src/RoutedSparqlDataAccessor.ts` (new), `packages/components/config/storage/hybrid.json`, `packages/components/config/storage/routed-sparql.json`, `packages/components/config/storage/sparql-endpoints.json` |
| Permission / grants | `packages/components/src/SaiAuthorizationManager.ts`, `SaiPermissionsEngine.ts`, `GrantIssuanceHandler.ts`, `GrantRevocationHandler.ts`, `AdminSparqlHandler.ts`, `services/Revocation.ts` |
| Session / allowlist | `packages/components/src/SessionManager.ts`, `packages/authorization-agent/src/authorization-agent.ts`, `packages/components/src/services/Context.ts`, `packages/components/src/services/queries/org.ts`, `packages/components/src/services/Authorization.ts` |
| Mirror | `packages/components/src/services/ReciprocalMirror.ts` (Fuseki `GRAPH` blocks), `packages/components/src/temporal/activities/reciprocal.ts` (owner endpoint), `packages/components/src/temporal/workflows/reciprocal.ts`, `packages/components/src/ActivityWebhookHandler.ts` |
| Infra fixes | `packages/components/src/PostgresKeyValueStorage.ts` (`entries`), `packages/components/src/temporal/activities/grants.ts` (delegation error reporting) |
| Bootstrap | `packages/components/src/services/Account.ts` |
| Docs | this file; `docs/plans/index.md`; `docs/plans/federation.md`; `docs/plans/isolated-datasets-and-sparql.md` |

## Tests

- **Package vitest** (`packages/components`): `SparqlEndpointStore` defineType /
  create / `findByPodUrl` / `findByWebId` / delete; `AccountService` bootstrap
  writes the registry + data records with per-pod endpoints + indexes.
- **Package vitest** (`packages/test-utils`): fixture splitter — every fixture
  graph assigned to exactly one pod dataset; registry vs data vs `shared`
  classification; the reciprocal-mirror backfill; `fusekiConfig` rendering.
- **`/test`** (user run): the integration suite drives the remaining fixes
  (`RoutedSparqlDataAccessor`, `findByIri`, the allowlist, the mirror write); the
  cross-pod isolation + mirror-freshness cases from
  `isolated-datasets-and-sparql.md` 4b are the cutover acceptance.

## Open items

- **Exact Fuseki image/tag** for compose + dagger: Stage 1 pins
  `secoresearch/fuseki:5.6.0` (multi-arch, includes the admin module — `/$/datasets`
  confirmed working); the Nix-built `sai-fuseki` image is the production
  follow-up.
- **Default-graph semantics** verified in stage 1 (`tdb2:unionDefaultGraph`
  only if a query actually needs it).
- **`id/<handle>` placement**: `shared` (recommended, no `id`-service change) vs
  the owner's registry pod (needs per-handle resolution in `services/id`).
- **`findByIri` full scan**: iterates the whole endpoint registry
  (`storage.entries`); fine for the fixture, cache/index it before large
  deployments.
- **Production Nix/podman/OCI** swap (follow-up; `production-consumer-cleanup.md`).
- **Separate S3 bucket per data pod** — separate plan.
- **Fuseki auth on the internal network**: dev/test leave SPARQL endpoints open
  (`/**=anon`, isolated docker network), matching Oxigraph today; production
  needs Shiro/network policy. The endpoint record makes the endpoint a
  capability, so a leaked URL is a real risk — decide before exposing.
- **`sparql-update.ts` N-Quads latent issue**: `insertPatch`/`deletePatch`
  produce N-Quads for a named-graph document, which Fuseki also rejects in
  `INSERT DATA`/`DELETE DATA` (no caller hits it today).
