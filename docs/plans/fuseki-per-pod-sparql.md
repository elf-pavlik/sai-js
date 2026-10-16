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
> **Update (typed endpoints).** The endpoint registry is now
> `PodEndpointStore`: two **typed** records — `sparqlEndpoint` (every pod) and
> `objectEndpoint` (data pods only: bucket + access key + secret) — both keyed
> by `podUrl`, with the owner reached **indirectly** through the account (no
> `webId` on the record). `CSS_S3_ENDPOINT` is bucket-less with a
> `CSS_S3_BUCKET`, and `S3DataAccessor` builds `endpoint/<bucket>`. Per-pod
> bucket/key provisioning is deferred to a Temporal account-creation workflow
> (see Open items).
>
> **Update (no shared/default endpoint).** The registry root `ldp:contains`
> index is gone; `<https://id/…>` profiles live in a dedicated **`id`** dataset
> (`CSS_ID_SPARQL_ENDPOINT`); every per-pod resource resolves from the store and
> **fails closed** (no fallback). `CSS_SPARQL_ENDPOINT` and the `shared` dataset
> are removed; the auth server only takes `CSS_FUSEKI_BASE_URL` for account
> creation (which moves to the Temporal workflow).
>
> **Update (startup follow-through, `/test` green).** With the default endpoint
> gone, three startup paths needed explicit handling and are landed: the CSS
> **v6 migration** is disabled
> (`config/overrides/disable-v6-migration.json` — fresh deployment, no v6 data;
> it read `/.internal/…` through the LDP backend); the **data server** uses
> `static-root` (no root container to persist); and a **non-pod** identifier in
> `RoutedSparqlDataAccessor` now raises `NotFoundHttpError` (ACP ancestor `.acr`
> reads treat the root as "no ACR"). The fixture's shapetrees `uuid:` prefix is
> fixed (`<urn:uuid>` → `<urn:uuid:>`).
>
> **Follow-up (subdomain `static-root` collision).** `static-root` + the
> **subdomain** identifier strategy (dev compose and the production
> `services/css/data.json`) collide at the path level: a pod root is `/` on a
> subdomain (`alice-home.data.docker/`), and CSS's `StaticAssetHandler` matches
> on the path only, so it shadowed every pod root container with the landing
> page (never visible on the path-based test server, where pod roots are
> `/pod/`). Fixed with `RootStaticAssetGuard`
> (`packages/components/src/RootStaticAssetGuard.ts`), which wraps
> `StaticAssetHandler` and refuses only the exact root path on a base-host
> subdomain so the request falls through to the LDP handler; wired via
> `config/overrides/base-http-handler.json` in `sai:config/data.json`.
>
> **Prerequisites** (both already landed or tracked elsewhere):
> - `isolated-datasets-and-sparql.md` **4a** — endpoint records in
>   `AccountLoginStorage`, `SessionManager` lookup, endpoint-store resolution
>   (this plan widens the record to per-pod; the env-var fallback has since been
>   removed).
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
| `services/id` | the dedicated **`id`** dataset (public WebID profiles) |

There is **no shared/default endpoint**. Every graph is either under a pod
(`reg-<handle>` / `data-<pod>`) or under the id origin, which has its own
dedicated **`id`** dataset (a single service, not per account). The old
`<https://registry/>` root `ldp:contains` index was dropped (the registry root
is a static page; the index leaked handles) and `shapetrees` / `test-client`
are ordinary acme-owned data pods with their own datasets. Resolution **fails
closed** — a missing endpoint record never falls back to a default.

## Decision — Fuseki topology, distribution, and endpoints

Apache Jena Fuseki ([admin protocol](https://jena.apache.org/documentation/fuseki2/fuseki-server-protocol.html),
[config](https://jena.apache.org/documentation/fuseki2/fuseki-configuration.html)):

- **One Fuseki server, N TDB2 datasets** (one per registry pod, one per data pod,
  plus the dedicated `id` dataset), declared in a `config.ttl`
  (`fuseki:Service` per dataset).
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
  registry + 13 data pods + the `id` dataset (deterministic, no admin calls
  needed at seed time). Dynamic `/$/datasets` is used for *new* accounts.
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

- `datasetForGraph(graphIri)` — map a graph IRI to a dataset:
  - strip a leading `meta:`;
  - the id origin (`https://id/<handle>` / the env's id origin) → `id`;
  - `https://registry/<handle>/…` → registry pod `reg-<handle>`;
  - `https://data/<pod-base>/…` → data pod `data-<pod-base>`;
  - anything else (or a default-graph quad) **throws** — there is no catch-all
    dataset.
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

### 1. `PodEndpointStore` (the typed records)

Modelled on
[`ReciprocalWebhookStore.ts`](../../packages/components/src/ReciprocalWebhookStore.ts),
backed by the same `AccountLoginStorage`. Endpoints are associated **directly
with the pod** (`podUrl`) and only **indirectly with the user** — the owner
WebID is reached through the account (`CustomWebIdStore.findAccount`, the
reverse `webIdLink` lookup), so the records carry `accountId` but no `webId`:

```ts
export const SPARQL_ENDPOINT_STORAGE_TYPE = 'sparqlEndpoint'
export const SPARQL_ENDPOINT_STORAGE_DESCRIPTION = {
  accountId: `id:${ACCOUNT_TYPE}`,
  podUrl: 'string',      // registry-set IRI or data pod base URL
  endpoint: 'string',    // e.g. http://fuseki:3030/reg-<handle>/sparql
} as const

// data pods only — the object (S3) endpoint; the region stays global config
export const OBJECT_ENDPOINT_STORAGE_TYPE = 'objectEndpoint'
export const OBJECT_ENDPOINT_STORAGE_DESCRIPTION = {
  accountId: `id:${ACCOUNT_TYPE}`,
  podUrl: 'string',
  endpoint: 'string',        // bucket-less S3 service endpoint
  bucket: 'string',
  accessKeyId: 'string',
  secretAccessKey: 'string',
} as const
```

Keyed by **pod URL**: a registry pod's URL is its registry-set IRI
(`https://<regOrigin>/<handle>/`), a data pod's is its storage base URL. The
registry-set IRI is exactly what `registryId(webId)` derives, so every caller
can produce the pod URL:

- indexes on `podUrl` and `accountId` for both types;
- `findSparqlByPodUrl` / `findObjectByPodUrl` → that pod's endpoint (the single
  resolver: AA session, data accessor, permission engine, `/sparql-admin`);
- `findSparqlByIri` / `findObjectByIri` → the record whose `podUrl` is the
  longest prefix of `iri` (resolves a registry resource like `…/grant/<id>` to
  its registry pod — used by the delegation/revocation handlers);
- `findSparqlByAccountId` / `findSparqlByWebId` (and the object twins) → all
  pods of the owner; the WebID variant resolves the account first;
- `createSparql`/`createObject` / `deleteSparql`/`deleteObject`.

Wired in `packages/components/config/storage/account.json` (with the
`webIdStore`, for owner enumeration) and
`packages/components/config/storage/pod-endpoints.json` (registry/data, no
WebID store); added to `PrimaryParallelInitializer` /
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

`AccountService` takes a Fuseki **base** URL
(`urn:sai:default:variable:fusekiBaseUrl`, env `CSS_FUSEKI_BASE_URL`, e.g.
`http://fuseki:3030`) and derives every dataset/GSP URL from it. There is **no**
`sparqlEndpoint` var — account creation is the only thing that needs the Fuseki
API, and it moves to the account-creation Temporal workflow.

### 3. `SessionManager` resolves the owner's registry pod and builds the allowlist

`packages/components/src/SessionManager.ts` gets the `PodEndpointStore`
injected (constructor arg) and, in `getSession(webid, registrySetId?)`, loads
**all** of the owner's records (`findSparqlByWebId(webid)`) into an allowlist
`sparqlEndpoints: Map<podUrl, endpoint>`. The registry endpoint is
`sparqlEndpoints.get(registrySetId ?? registryId(webid))`; a missing record
**throws** (no env fallback). Both `sparqlEndpoint` and `sparqlEndpoints` are passed to
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
  → `findSparqlByPodUrl(podBase)`;
- **registry server**: first path segment `<handle>` → registry pod URL
  `${CSS_BASE_URL}${handle}/` → `findSparqlByPodUrl(...)` (no `idOrigin` needed — the
  registry server's own base URL *is* the registry origin);
- **fail closed** when unresolved: an identifier with no storage (e.g. the root
  container) or no endpoint record throws.

Replace `urn:solid-server:default:SparqlDataAccessor` with it via the Override
in `packages/components/config/storage/routed-sparql.json` (imported by both
`registry.json` and `data.json`); `pod-endpoints.json` adds the
`PodEndpointStore` to those servers' initializers.

### 5. Permission engine resolves the data owner's registry pod ✅

`SaiAuthorizationManager.getAuthorizationData` / `SaiPermissionsEngine` collect
grants with `GRAPH ?g { ?s interop:hasStorage <storage> }`. With per-pod
datasets the grants are **not** in the data pod's dataset. Before the query,
resolve the storage owner (as in §4 data server) → `registryId(owner)` →
`findSparqlByPodUrl(...)` → run the grant query against that endpoint. `SaiPermissionsEngine`
resolves the **resource's data pod** for the inheritance query. Same lookup for
`GrantIssuanceHandler.validateDelegable` and `GrantRevocationHandler` (via
`findSparqlByIri(grantIri)`, since the owner is read off the grant IRIs).

### 6. Session/context endpoint allowlist (isolation) ✅

The session may only query the pods recorded for its owner in the internal
account storage — never another owner's dataset:

- `AuthorizationAgent` holds `sparqlEndpoints: Map<podUrl, endpoint>` and exposes
  `resolveEndpoint(iri)` (longest pod-URL prefix) and `sparqlTransportFor(iri)`
  (**throws** when the IRI is not under an allowed pod).
- `ResolvedContext.endpoints` is the context allowlist: personal =
  `session.sparqlEndpoints`; org = `findSparqlByWebId(ctx.webId)` (the **org's**
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
  "<uuid>": { "accountId": "<id>", "podUrl": "https://registry/<handle>/",
              "endpoint": "http://fuseki:3030/reg-<handle>/sparql" },
  "<uuid2>": { "accountId": "<id>", "podUrl": "https://data/<pod>/",
               "endpoint": "http://fuseki:3030/data-<pod>/sparql" }
},
"**objectEndpoint**": {
  "<uuid3>": { "accountId": "<id>", "podUrl": "https://data/<pod>/",
               "endpoint": "http://garage:3900", "bucket": "sai-dev",
               "accessKeyId": "…", "secretAccessKey": "…" }
},
```

one SPARQL record per registry pod (6) and per data pod (**13** — the account
pods plus `data/shapetrees` and `data/test-client`, both `dataOwner
<https://id/acme>` in the fixture's public grants), and one **object** record
per data pod. Matching index entries:
`accounts/index/sparqlEndpoint/<uuid>`, `.../accountId/<id>` and
`.../podUrl/<encoded>`, plus the `objectEndpoint` twins.
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
| AA session reads | `session.sparqlEndpoint` = one env endpoint | owner's **registry pod** endpoint; a missing record throws (no fallback) |
| `SaiAuthorizationManager` / `SaiPermissionsEngine` / `GrantIssuanceHandler` / `GrantRevocationHandler` / `ApiHandler` / `AdminSparqlHandler` | config-bound `urn:solid-server:default:variable:sparqlEndpoint` | resolve from the **endpoint store** (storage owner's registry pod / the grant's pod); fail closed |
| `/sparql-admin` | forwards to the global endpoint | forwards into the org's **registry pod**; `?pod=<podUrl>` targets another of the org's pods (account ownership-checked) |
| `services/id` (`CONSTRUCT <https://id/<handle>>`) | single endpoint | dedicated **`id`** dataset (`CSS_ID_SPARQL_ENDPOINT`); WebID profiles live there |
| `SparqlDataAccessor` (registry + data) | single endpoint | `RoutedSparqlDataAccessor` (no fallback) |
| Temporal mirror activities (`syncReciprocalMirror` etc.) | `process.env.CSS_SPARQL_ENDPOINT` (`reciprocal.ts:149`) | `session.sparqlEndpoint` (owner's registry pod) |
| Env | `CSS_SPARQL_ENDPOINT` on auth/registry/data/worker | **removed**; auth only takes `CSS_FUSEKI_BASE_URL` for account creation |

## Integration hardening (surfaced by `/test`)

Fixes required to make the split green end-to-end (each landed):

- **AA data-plane reads** (`components/src/services/Authorization.ts`):
  `findUserDataRegistrations` / `generateSourceDataGrants` read data
  registrations from the context's pods (allowlist), not `registrySet`.
- **Own data-registry listing** (`components/src/services/DataRegistry.ts`):
  `buildDataRegistry` resolves each `hasDataRegistry` IRI through
  `sparqlTransportForPod` — the registry's `ldp:contains` listing and the
  registration graphs live in the data pod's dataset, so the registry-plane
  transport (`sparqlTransportFor`) listed nothing (data registries showed, but
  with zero registrations).
- **Empty data registrations** (`packages/data-model/src/data-registration.ts`):
  `fromJsonLd` defaults `contains` to `[]`. A registration with no instances has
  no `ldp:contains` triples (CSS stores containment in the resource graph and
  metadata in `meta:`), so framing omitted the key and `listDataInstances` /
  grant generation crashed iterating it. Also added the missing
  resource-graph `ldp:contains` for the fixture's `alice-work/btze4a` (Task)
  registration, whose three instances existed only as `pm:hasTask` references.
- **`PostgresKeyValueStorage.entries`** (first caller = `findSparqlByIri`):
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

- `packages/components/src/PodEndpointStore.ts` — AccountLoginStorage types
  `sparqlEndpoint` (every pod) and `objectEndpoint` (data pods), keyed by
  `podUrl` with `accountId` (owner reached indirectly); indexes on
  `podUrl`/`accountId`; `createSparql`/`createObject` + the `find…`/`delete`
  methods; wired into `config/storage/account.json` (both parallel
  initializers) and exported for the generator.
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

- `environments/css/fuseki.config.ttl` — generated, **20 datasets** (6
  `reg-<handle>` + 13 `data-<pod>`, plus a dedicated `id` dataset; the initial
  `shared` dataset has since been removed — see the Updates at the top) via
  `packages/test-utils/src/fuseki.ts` (`fusekiConfig`).
- **Fixture split + mirror backfill** (`splitFixtureByPod`): routes each graph
  to its pod dataset and copies each reciprocal target (+ its grants) into the
  linking owner's dataset — the offline equivalent of `updateReciprocalMirror`.
- `test/setup.ts` + `packages/repl` `seed-env` seed every per-pod dataset.
- `environments/data/kv.json` endpoint records flipped to per-pod URLs
  (`http://fuseki:3030/reg-<handle>/sparql`, `.../data-<pod>/sparql`).
- `Account.ts` creates the two datasets (admin API, `CSS_FUSEKI_ADMIN`) and
  POSTs the bootstrap TriG per dataset (the WebID profile goes to the `id`
  dataset).
- **`RoutedSparqlDataAccessor`** (new) — `StorageLocationStrategy` → pod URL →
  `findSparqlByPodUrl`; replaces CSS's single-endpoint accessor on registry + data.
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
| Dev env | `docker-compose.yaml` (`fuseki`, `CSS_FUSEKI_BASE_URL`, `CSS_ID_SPARQL_ENDPOINT`, `depends_on`, `id`/`registry`/`data`/`worker`) |
| Test env | `.dagger/src/index.ts` (`fusekiService`, `CSS_FUSEKI_BASE_URL`, `CSS_ID_SPARQL_ENDPOINT`, bindings) |
| Seeds | `packages/test-utils/src/env.ts` (+ new `fuseki.ts`), `test/setup.ts`, `packages/repl/cmd.ts`, `environments/data/kv.json`, `environments/data/registry.trig` (registry root index removed) |
| CSS store | `packages/components/src/PodEndpointStore.ts` (new; SPARQL + object/S3 typed records), `packages/components/src/CustomWebIdStore.ts` (`findAccount`), `packages/components/src/index.ts`, `packages/components/config/storage/account.json`, `packages/components/config/storage/pod-endpoints.json`, `packages/components/config/variables/s3.json`, `packages/components/config/variables/fuseki.json` |
| ID service | `services/id/server.ts` (`CSS_ID_SPARQL_ENDPOINT`), `services/id/cid.ts` |
| CSS routing | `packages/components/src/RoutedSparqlDataAccessor.ts` (new), `packages/components/config/storage/hybrid.json`, `packages/components/config/storage/routed-sparql.json` |
| Permission / grants | `packages/components/src/SaiAuthorizationManager.ts`, `SaiPermissionsEngine.ts`, `GrantIssuanceHandler.ts`, `GrantRevocationHandler.ts`, `AdminSparqlHandler.ts`, `services/Revocation.ts` |
| Session / allowlist | `packages/components/src/SessionManager.ts`, `packages/authorization-agent/src/authorization-agent.ts`, `packages/components/src/services/Context.ts`, `packages/components/src/services/queries/org.ts`, `packages/components/src/services/Authorization.ts` |
| Mirror | `packages/components/src/services/ReciprocalMirror.ts` (Fuseki `GRAPH` blocks), `packages/components/src/temporal/activities/reciprocal.ts` (owner endpoint), `packages/components/src/temporal/workflows/reciprocal.ts`, `packages/components/src/ActivityWebhookHandler.ts` |
| Infra fixes | `packages/components/src/PostgresKeyValueStorage.ts` (`entries`), `packages/components/src/temporal/activities/grants.ts` (delegation error reporting) |
| Bootstrap | `packages/components/src/services/Account.ts` |
| Docs | this file; `docs/plans/index.md`; `docs/plans/federation.md`; `docs/plans/isolated-datasets-and-sparql.md` |

## Tests

- **Package vitest** (`packages/components`): `PodEndpointStore` defineType /
  create / `findSparqlByPodUrl` / `findSparqlByAccountId` / `findSparqlByWebId`
  / `findSparqlByIri` / delete plus the object-endpoint CRUD; `AccountService`
  bootstrap writes pod-keyed SPARQL + object records and their indexes.
- **Package vitest** (`packages/test-utils`): fixture splitter — every fixture
  graph assigned to exactly one per-pod dataset or the `id` dataset; unmatched
  graphs throw; the reciprocal-mirror backfill; `fusekiConfig` rendering.
- **`/test`** (user run): the integration suite drives the remaining fixes
  (`RoutedSparqlDataAccessor`, `findSparqlByIri`, the allowlist, the mirror write); the
  cross-pod isolation + mirror-freshness cases from
  `isolated-datasets-and-sparql.md` 4b are the cutover acceptance.

## Open items

- **Exact Fuseki image/tag** for compose + dagger: Stage 1 pins
  `secoresearch/fuseki:5.6.0` (multi-arch, includes the admin module — `/$/datasets`
  confirmed working); the Nix-built `sai-fuseki` image is the production
  follow-up.
- **Default-graph semantics** verified in stage 1 (`tdb2:unionDefaultGraph`
  only if a query actually needs it).
- **`id/<handle>` placement** — **resolved**: a dedicated **`id`** dataset
  (`CSS_ID_SPARQL_ENDPOINT`), written by account creation; no per-handle
  resolution in the `id` service.
- **`shared` dataset / default endpoint** — **removed**. The registry root
  index and the env fallback are gone; these components fail closed. The only
  runtime writer that used to target `shared` was the data server's root
  container (`.acr`/`.acl`/`.meta` from `initialize-root`); it now fails closed
  and `ContainerInitializer` logs-and-continues, so startup is unaffected.
- **`findSparqlByIri` full scan**: iterates the whole endpoint registry
  (`storage.entries`); fine for the fixture, cache/index it before large
  deployments.
- **Production Nix/podman/OCI** swap (follow-up; `production-consumer-cleanup.md`).
  Note: auth now requires `CSS_FUSEKI_BASE_URL`; `nix/podman.nix` still sets the
  removed `CSS_SPARQL_ENDPOINT` and lacks it.
- **One S3 bucket per data pod** — see
  [`isolated-s3-buckets.md`](isolated-s3-buckets.md). The typed `objectEndpoint`
  record and the bucket-less `CSS_S3_ENDPOINT` split have landed; bootstrap still
  copies the temporary `sai-dev` default, and that plan **removes `sai-dev` /
  `CSS_S3_BUCKET` entirely**, replacing them with per-pod bucket/key provisioning
  + `RoutedS3DataAccessor`.
- **Fuseki auth on the internal network**: dev/test leave SPARQL endpoints open
  (`/**=anon`, isolated docker network), matching Oxigraph today; production
  needs Shiro/network policy. The endpoint record makes the endpoint a
  capability, so a leaked URL is a real risk — decide before exposing.
- **`sparql-update.ts` N-Quads latent issue**: `insertPatch`/`deletePatch`
  produce N-Quads for a named-graph document, which Fuseki also rejects in
  `INSERT DATA`/`DELETE DATA` (no caller hits it today).
