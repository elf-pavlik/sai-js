# Isolated S3 buckets — one bucket + key per data pod

> **Status:** in progress — steps 1–5 landed: `GarageAdminClient` +
> `RoutedS3DataAccessor` (data server routes per data pod), the worker env +
> `garage` binding, account creation as a Temporal workflow, per-pod bucket/key
> seeding (fixture + `packages/repl`), and the `sai-dev`/`CSS_S3_BUCKET`
> retirement with the key-scoping `/test` case. Remaining: the open items below
> (production Nix/podman Garage wiring, orphan reconciliation, account deletion).
> Follow-up to
> [`fuseki-per-pod-sparql.md`](fuseki-per-pod-sparql.md) (the typed
> `objectEndpoint` records landed) and `isolated-datasets-and-sparql.md` 4b.
> Environment-touching (compose + dagger) and code-touching (components +
> Temporal). Account creation moves into a Temporal workflow.

## Problem

Every data pod's blobs currently land in **one** bucket (`sai-dev`):
`S3DataAccessor` takes a single `endpoint`/`bucket` from config and uses
`identifier.path` as the object key, so all pods share it. `RoutedSparqlDataAccessor`
isolates the SPARQL plane per pod, but the object plane is still shared — a
leaked or compromised key reaches every pod's blobs.

The typed registry already carries an object endpoint per data pod
(`objectEndpoint`: `endpoint`, `bucket`, `accessKeyId`, `secretAccessKey`), but
bootstrap copies the same env defaults into every record, so nothing is isolated
yet.

## Goal

- **Remove the `sai-dev` placeholder and the `CSS_S3_BUCKET` default entirely** —
  there is no shared/default bucket; every data pod's object endpoint comes from
  its own record.
- **One bucket + one key per data pod**, created at account creation, the key
  scoped to that bucket (`read`/`write`/`owner`).
- Account creation becomes a **Temporal workflow**; Garage bucket/key creation is
  an activity over the **Garage v2 admin API**.
- The data server resolves the resource's data pod and uses **that pod's** bucket
  and key (a `RoutedS3DataAccessor`), mirroring `RoutedSparqlDataAccessor`.
- The **worker** (not auth) holds the Garage admin token.
- `region` stays global config; the record's `endpoint` stays bucket-less.

## Current state (already landed)

- `PodEndpointStore` (`packages/components/src/PodEndpointStore.ts`) — typed
  `objectEndpoint` records keyed by `podUrl`, owner via `accountId`; methods
  `createObject` / `findObjectByPodUrl` / `findObjectByAccountId` /
  `findObjectByWebId` / `findObjectByIri` / `deleteObject`.
- `AccountService.bootstrapAccount` writes the data pod's object record from env
  (`CSS_S3_ENDPOINT`, `CSS_S3_BUCKET ?? 'sai-dev'`, `CSS_S3_ACCESS_KEY_ID`,
  `CSS_S3_SECRET_ACCESS_KEY`) — a **placeholder** the plan removes once the
  workflow provisions per-pod buckets/keys.
- `S3DataAccessor` takes `{ endpoint, bucket, accessKeyId, secretAccessKey, region }`
  and builds `endpoint/<bucket>` for s3mini.
- `config/storage/hybrid.json` wires `HybridDataAccessor.binaryAccessor` to the
  `RoutedS3DataAccessor` (data server only); the registry server has no object
  plane.
- `environments/data/kv.json` seeds 13 data-pod object records, all `sai-dev` —
  replaced by per-pod buckets/keys provisioned at seed time. Their
  `accounts/index/objectEndpoint/podUrl/<…>` keys must be
  `encodeURIComponent`-encoded like the `sparqlEndpoint` ones: the seeded
  entries left the scheme colon literal (`https:%2F%2F…`), so
  `WrappedIndexedStorage`'s index lookup (which builds `https%3A%2F%2F…`) never
  matched and `findObjectByPodUrl` returned nothing. Latent under the single
  `S3DataAccessor`; exposed once `RoutedS3DataAccessor` consumed the store.
- `CSS_S3_ENDPOINT` (bucket-less `http://garage:3900`) + `CSS_S3_BUCKET`
  (default `sai-dev`) + access key + secret are set for auth + data (compose +
  dagger); `sai-dev`/`CSS_S3_BUCKET` are removed by this plan.
- Garage (`dxflrs/garage:v2.2.0`) exposes the S3 API on `3900` and the **admin
  API on `3903`** with `admin_token` in `garage/garage.toml`.
- `GarageAdminClient` (`packages/components/src/GarageAdminClient.ts`) — the
  Garage v2 admin client (find-first `ensureBucket`, `createKey`,
  `allowBucketKey`, `deleteBucket`/`deleteKey`; injectable `fetch`). Not a
  Components.js component (`.componentsignore`), used by the Temporal activity.
- `RoutedS3DataAccessor` (`packages/components/src/RoutedS3DataAccessor.ts`) —
  resolves the resource's data pod via `StorageLocationStrategy`, reads its
  `objectEndpoint` record and delegates to a cached `S3DataAccessor` per
  `(endpoint, bucket)`; there is **no default bucket**. Wired as
  `HybridDataAccessor.binaryAccessor` in `config/storage/hybrid.json` (data
  server only). The sketch's `identifierStrategy` argument is dropped —
  `S3DataAccessor` does not need it (unlike `SparqlDataAccessor`).

## Decision — Garage v2 admin API contract

Base `http://garage:3903`, header `Authorization: Bearer <admin_token>` (from
`garage/garage.toml` `[admin] admin_token`). **Verified against the pinned
`dxflrs/garage:v2.2.0`** (`doc/api/garage-admin-v2.json`, admin API v2.2.0) and
encoded in `GarageAdminClient`:

| Step | Call | Body / params | Notes |
|---|---|---|---|
| bucket | `POST /v2/CreateBucket` | `{ "globalAlias": "data-<pod>" }` | returns `GetBucketInfoResponse`; **an existing alias is an error**, so callers do find-first via `ListBuckets` |
| key | `POST /v2/CreateKey` | `{ "name": "data-<pod>" }` | returns `GetKeyInfoResponse` incl. `secretAccessKey` (readable only at creation) |
| grant | `POST /v2/AllowBucketKey` | `{ "bucketId", "accessKeyId", "permissions": { "read": true, "write": true, "owner": true } }` | a `true` flag **activates** a permission, `false` leaves it unchanged — there is no deny via this call (`DenyBucketKey` is separate) |
| lookup | `GET /v2/ListBuckets`, `GET /v2/ListKeys` | — | both return arrays; `ListKeys` id field is `id` (= access key id) and is normalised to `accessKeyId` |
| lookup | `GET /v2/GetBucketInfo?globalAlias=…`, `GET /v2/GetKeyInfo?id=…` | — | an unknown id/alias is a 500 (indistinguishable from a real failure) — prefer the list endpoints for find-first |
| cleanup | `POST /v2/DeleteBucket?id=…`, `POST /v2/DeleteKey?id=…` | query param `id` | 404 when missing (treated as idempotent success) |

`globalAlias` is the S3 bucket name used by `endpoint/<bucket>`; the API also
returns an opaque `bucketId` used by `AllowBucketKey`.

## Decision — account creation is a Temporal workflow

Replace `ApiHandler.bootstrapAccount`'s synchronous `AccountService.bootstrapAccount`
with "start the workflow, return the webId" — landed as
`AccountService.startBootstrapAccount` (auth) → `bootstrapAccount` workflow
(`temporal/workflows/account.ts`) → `temporal/activities/account.ts`, on the
`create-grants` queue (the worker bundle re-exports it). The workflow id is
stable per account (`account-bootstrap:<accountId>`), so a duplicate RPC reuses
the execution. Activities:

1. `createFusekiDatasets(handle)` — `POST {fusekiBaseUrl}/$/datasets?dbType=tdb2&dbName=…`
   for `reg-<handle>` and `data-<handle>` (ensure `id`), idempotent.
2. `createObjectBucket(podUrl)` — Garage `CreateBucket` + `CreateKey` +
   `AllowBucketKey`; find-first via the `objectEndpoint` record (skip if it
   already exists).
3. `writeEndpointRecords(handle, …)` — `PodEndpointStore.createSparql` for the
   registry + data pods and `createObject` for the data pod (instead of
   hand-written KV/index keys).
4. `postBootstrapTriG(handle, …)` — WebID profile to the `id` dataset, registry
   set + data registry to their datasets.
5. `writeAccountRecords(accountId, …)` — pod/owner/webIdLink (the existing blob).

Crash/retry: activities are find-first (record-driven) — a retry after a partial
run reuses the bucket/key. Compensation on failure after creation: best-effort
`DeleteBucket`/`DeleteKey` (and a reconcile sweep, see Open items).

> **Gotcha (landed):** `writeAccountRecords`'s find-first must check for a
> **non-empty** `**webIdLink**` container. CSS's `WrappedIndexedStorage.create`
> initializes every child container to `{}` on the account record, so a plain
> truthiness check short-circuits before the index is ever written.

> **Alternative considered:** keep it synchronous and call Garage from
> `AccountService`. Rejected — issuance already runs through Temporal, and a
> half-created account (bucket without account rows, or vice versa) needs
> retry + compensation.

## Decision — `RoutedS3DataAccessor`

Mirror `RoutedSparqlDataAccessor`, binary-only:

```ts
class RoutedS3DataAccessor implements DataAccessor {
  constructor(identifierStrategy, storageStrategy, endpointStore, region)
  // getStorageIdentifier(identifier).path → findObjectByPodUrl(podUrl)
  //   non-pod identifier            → NotFoundHttpError
  //   pod without an object record  → Error (500, misconfiguration)
  // cache S3DataAccessor per (endpoint, bucket)
}
```

- Only `canHandle` (binary), `getData`, `writeDocument`, `deleteResource` are
  meaningful; metadata/container methods throw `NotImplementedHttpError` like
  `S3DataAccessor`.
- Wire `HybridDataAccessor.binaryAccessor` to it in `hybrid.json` (data server
  only — the registry server has no object plane).
- `region` stays global (`CSS_S3_REGION`); the record's `endpoint` is
  bucket-less and the delegate builds `endpoint/<bucket>`.

## Fail-closed / no default bucket

- Registry pods have no object endpoint (RDF only).
- A data pod without an `objectEndpoint` record (or a non-pod path) fails closed.
- **`sai-dev` and `CSS_S3_BUCKET` are removed entirely** — there is no shared
  bucket and no fallback. `S3DataAccessor` is constructed only from a pod's
  record; the data server's config keeps just the global `region` (endpoint,
  bucket and credentials all come from the record).

## Fixture / seed

Landed. The fixture is per-pod too (there is no shared bucket):
`seedObjectEndpoints` in `packages/test-utils/src/garage.ts` provisions a
bucket+key per data pod through the Garage v2 admin API and merges the typed
`objectEndpoint` records + indexes into the fixture before it is written to the
key-value store. Keys are generated, so they can't be static in `kv.json` — the
fixture drops its `**objectEndpoint**` entries and the seed creates them at run
time.

The helper is find-first and **reuses** an existing bucket/key rather than
churning it (a key's secret is read back with `GetKeyInfo?showSecretKey=true`),
which matters because vitest runs `test/setup.ts` once per test file. Bucket and
key names equal the pod's Fuseki dataset name (`data-<pod>`).

- `test/setup.ts` provisions against `http://garage:3903` (the dagger `garage`
  binding) and uses the `data-test-client` pod's generated key for the seeded
  client-id object.
- `packages/repl seed-env` provisions against the host-published
  `http://localhost:3903` (token read from `garage/garage.toml`), then seeds the
  mapped fixture.

Two pre-existing dev/demo-seed bugs surfaced while wiring this (the fixture is
split per pod now):

- **Dataset names must come from the fixture's own `sparqlEndpoint` records**,
  not from the mapped pod URL — the dev/demo map renames the test-client pod
  (`test-client` → `vuejectron.data.docker`) while its dataset stays
  `data-test-client` (as its endpoint record and the Fuseki config say).
  `seed-env` and `seedObjectEndpoints` both read the dataset name from the
  endpoint record.
- **`meta:` graphs must be mapped with `meta:` prefixes first.** `graphRegExp`
  only matched non-`meta` graph IRIs, so `<meta:…>` lines took the generic
  path and a non-`meta` mapping rewrote the inner IRI first
  (`meta:https://data/test-client/public/id` → `meta:https://vuejectron.docker/id`,
  outside any pod).

## Env / worker

- **Worker** needs `CSS_GARAGE_ADMIN_TOKEN` (from `garage/garage.toml`) and a
  `garage` service binding in dagger (compose already shares the network).
- **Auth** keeps `CSS_FUSEKI_BASE_URL` (declared; dataset creation now runs on
  the worker) but no longer needs the S3 credentials.
- **Landed:** `CSS_S3_BUCKET` / `CSS_S3_ACCESS_KEY_ID` / `CSS_S3_SECRET_ACCESS_KEY`
  are gone repo-wide; the global `CSS_S3_ENDPOINT` is gone from every CSS server
  (auth/data/registry) and kept only on the **worker** (which writes it into new
  `objectEndpoint` records). `variables/s3.json` is now just `s3Region`, and the
  auth config no longer imports it.
- Do not use a `CSS_`-prefixed var on a CSS server unless the corresponding CLI
  param is declared — the worker reads `process.env` directly, so a `CSS_` name
  is fine there. (This bit twice: `CSS_S3_ENDPOINT` on the data server and
  `CSS_FUSEKI_ADMIN` on auth both needed the param declared/removed.)

## Tests

- **Package vitest** (`components`): `RoutedS3DataAccessor` routing (pod → bucket,
  non-pod → 404, missing record → 500); the Garage admin client with a mocked
  fetch — create, idempotent re-run, allow, cleanup.
- **Temporal** effect tests for the activities once the effects suite lands
  (find-first, compensation).
- **`/test`** (`test/key-scoping.test.ts`): every data pod has its own bucket +
  key; a pod's key can upload to and read its own bucket but gets 403 on another
  pod's bucket (read and write). (The LDP routing itself is covered by the
  `RoutedS3DataAccessor` unit tests and the suite's binary reads; an
authenticated LDP upload isn't reliably available — the policy engine authorizes
from DataGrants, with no owner self-bypass.)
- **`/test` account-creation regression** (`test/account-creation.test.ts`):
  signed up a brand-new handle through the CSS `.account` controls (the signup
  cookie is created by the test), ran `BootstrapAccount`, and polled for the
  WebID profile, both per-pod datasets and the `sparqlEndpoint`/`objectEndpoint`
  records (and the reverse `webIdLink` index that `checkHandle` queries). The
  poll makes it pass both before and after bootstrap moves to a Temporal
  workflow. It deliberately does **not** issue a second RPC after bootstrap:
  any RPC on an account that already has a WebID makes the auth server
  `getSession(webId)`, which fetches the subdomain WebID `https://<handle>.id` —
  dagger has no wildcard DNS for it (unlike the path-based document
  `https://id/<handle>`), so the store is asserted directly. Prereq (wired in
  dagger + compose): the Fuseki admin
  service account (`ADMIN_PASSWORD` on fuseki, `CSS_FUSEKI_ADMIN` on auth, the
  latter declared as the optional `fusekiAdmin` CLI param) so
  new signups can create their datasets dynamically.

## Files

| Area | File(s) |
|---|---|
| Garage client | new `GarageAdminClient` (`packages/components/src/…`), used by a new activity |
| Records | `packages/components/src/PodEndpointStore.ts` (`createObject` already present) |
| Routing | new `packages/components/src/RoutedS3DataAccessor.ts`, `config/storage/hybrid.json` |
| Bootstrap | `packages/components/src/services/Account.ts` → Temporal activities; `temporal/workflows/*`, `temporal/activities/*` |
| Worker / env | `.dagger/src/index.ts`, `docker-compose.yaml` (`CSS_GARAGE_ADMIN_ENDPOINT`/`CSS_GARAGE_ADMIN_TOKEN` + `garage` binding; `CSS_S3_ENDPOINT` only on the worker; `CSS_S3_BUCKET`/global keys removed) |
| Seeds | `packages/test-utils/src/garage.ts` (`seedObjectEndpoints`), `test/setup.ts`, `packages/repl/cmd.ts`, `environments/data/kv.json` (dropped `**objectEndpoint**`), `packages/components/config/variables/s3.json` (step 5: reduce to `s3Region`) |

## Open items

- Key idempotency — **resolved**: `createObjectBucket` is record-driven
  find-first; with no record it find-firsts the bucket and delete-and-recreates
  a key named `data-<pod>` (a secret is only readable at creation), with
  best-effort `DeleteKey`/`DeleteBucket` compensation on failure.
- Orphan reconciliation: a reconcile activity (like `reconcileActivities`) that
  drops buckets/keys with no endpoint record and vice versa.
- Bucket/key deletion on account deletion (no account-deletion flow exists).
- Production Nix/podman wiring for the Garage admin token
  (`production-consumer-cleanup.md`).
- Committed Garage state — **trimmed**: only `garage/meta/cluster_layout`,
  `meta/node_key`, `meta/node_key.pub` (plus the `.gitkeep`s and `garage.toml`)
  are tracked; `db.sqlite*`, `data_layout`, the data-dir marker, runtime state and
  the object store are git-ignored and regenerated. The leftover `sai-dev`
  bucket/key/objects are gone, so the seed starts from an empty cluster (see
  `garage/README.md` and `.gitignore`).

## Sequencing

1. ✅ `GarageAdminClient` + `RoutedS3DataAccessor` (record consumption) with
   unit tests + `hybrid.json` wiring; the temporary `sai-dev` records still
   exercise it until steps 3–5 provision per-pod buckets/keys.
2. ✅ Worker env/binding (`CSS_GARAGE_ADMIN_ENDPOINT` + `CSS_GARAGE_ADMIN_TOKEN`,
   `garage` binding; plus `CSS_FUSEKI_BASE_URL`/`CSS_FUSEKI_ADMIN` for the
   dataset activity).
3. ✅ Move account creation into the Temporal workflow (Fuseki + Garage + records
   + TriG) with find-first + compensation (`temporal/activities/account.ts`,
   `temporal/workflows/account.ts`, starter in `services/Account.ts`).
4. ✅ Seed per-pod buckets/keys (fixture + `packages/repl`) via
   `test-utils/src/garage.ts#seedObjectEndpoints`; `kv.json` dropped its
   `**objectEndpoint**` entries.
5. ✅ Retire `sai-dev` / `CSS_S3_BUCKET` / global S3 keys + `s3Endpoint` variable
   (`variables/s3.json` → `s3Region` only; `CSS_S3_ENDPOINT` kept on the worker
   only); add `test/key-scoping.test.ts`.

## References

- [`fuseki-per-pod-sparql.md`](fuseki-per-pod-sparql.md) — the typed
  `objectEndpoint` records and the SPARQL-plane routing this mirrors.
- `isolated-datasets-and-sparql.md` 4b — the per-pod isolation contract.
- `federation.md` — the single-deployment shortcuts.
