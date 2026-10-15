# Isolated S3 buckets — one bucket + key per data pod

> **Status:** design (not started). Follow-up to
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
- `config/storage/hybrid.json` wires `HybridDataAccessor.binaryAccessor` to a
  single `S3DataAccessor` (data server only).
- `environments/data/kv.json` seeds 13 data-pod object records, all `sai-dev` —
  replaced by per-pod buckets/keys provisioned at seed time.
- `CSS_S3_ENDPOINT` (bucket-less `http://garage:3900`) + `CSS_S3_BUCKET`
  (default `sai-dev`) + access key + secret are set for auth + data (compose +
  dagger); `sai-dev`/`CSS_S3_BUCKET` are removed by this plan.
- Garage (`dxflrs/garage:v2.2.0`) exposes the S3 API on `3900` and the **admin
  API on `3903`** with `admin_token` in `garage/garage.toml`.

## Decision — Garage v2 admin API contract

Base `http://garage:3903`, header `Authorization: Bearer <admin_token>` (from
`garage/garage.toml` `[admin] admin_token`). Fields to **verify against the
pinned Garage version's `/v2` OpenAPI**:

| Step | Call | Body | Notes |
|---|---|---|---|
| bucket | `POST /v2/CreateBucket` | `{ "globalAlias": "data-<pod>" }` | bucket name == the Fuseki dataset name (`data-<pod>`); "already exists" → fetch |
| key | `POST /v2/CreateKey` | `{ "name": "data-<pod>" }` | returns `{ accessKeyId, secretAccessKey, name, … }` |
| grant | `POST /v2/AllowBucketKey` | `{ "bucketId", "accessKeyId", "permissions": { "read": true, "write": true, "owner": true } }` | scopes the key to the bucket |
| lookup | `GET /v2/GetBucketInfo?globalAlias=…`, `GET /v2/ListBuckets`, `GET /v2/ListKeys` | — | idempotency / reconciliation |
| cleanup | `POST /v2/DeleteBucket`, `POST /v2/DeleteKey` | `{ "bucketId" }` / `{ "accessKeyId" }` | compensation |

`globalAlias` is the S3 bucket name used by `endpoint/<bucket>`; the API also
returns an opaque `bucketId` used by `AllowBucketKey`.

## Decision — account creation is a Temporal workflow

Replace `ApiHandler.bootstrapAccount`'s synchronous `AccountService.bootstrapAccount`
with "start the workflow, return the webId". Activities (reuse the
`create-grants` queue or add an `account-bootstrap` queue):

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

The fixture must be per-pod too (there is no shared bucket): the seed
(`test/setup.ts` + `packages/repl`) provisions a bucket+key per data pod through
the Garage admin API and inserts the `objectEndpoint` records with the generated
credentials. Keys are generated, so this can't be static in `kv.json` — the seed
creates them at run time via a small `test-utils` Garage helper, and `kv.json`
drops its `**objectEndpoint**` entries. `packages/repl seed-env` reaches the
admin API on `http://localhost:3903` (Garage publishes it on the host).

## Env / worker

- **Worker** needs `CSS_GARAGE_ADMIN_TOKEN` (from `garage/garage.toml`) and a
  `garage` service binding in dagger (compose already shares the network).
- **Auth** keeps `CSS_FUSEKI_BASE_URL` (dataset creation) but no longer needs the
  S3 credentials once the workflow owns bucket/key creation.
- **Remove** `CSS_S3_BUCKET` (and, once records carry endpoint+credentials, the
  global `CSS_S3_ENDPOINT` / `CSS_S3_ACCESS_KEY_ID` / `CSS_S3_SECRET_ACCESS_KEY`)
  from `variables/s3.json`, compose and dagger; `variables/s3.json` reduces to
  `s3Region`.
- Do not use a `CSS_`-prefixed var on a CSS server unless the corresponding CLI
  param is declared — the worker reads `process.env` directly, so a `CSS_` name
  is fine there.

## Tests

- **Package vitest** (`components`): `RoutedS3DataAccessor` routing (pod → bucket,
  non-pod → 404, missing record → 500); the Garage admin client with a mocked
  fetch — create, idempotent re-run, allow, cleanup.
- **Temporal** effect tests for the activities once the effects suite lands
  (find-first, compensation).
- **`/test`**: upload a blob in two pods → distinct buckets; pod A's key cannot
  read pod B's bucket (403).

## Files

| Area | File(s) |
|---|---|
| Garage client | new `GarageAdminClient` (`packages/components/src/…`), used by a new activity |
| Records | `packages/components/src/PodEndpointStore.ts` (`createObject` already present) |
| Routing | new `packages/components/src/RoutedS3DataAccessor.ts`, `config/storage/hybrid.json` |
| Bootstrap | `packages/components/src/services/Account.ts` → Temporal activities; `temporal/workflows/*`, `temporal/activities/*` |
| Worker / env | `.dagger/src/index.ts`, `docker-compose.yaml` (`CSS_GARAGE_ADMIN_TOKEN`, `garage` binding; remove `CSS_S3_BUCKET`) |
| Seeds | `packages/test-utils/src/…` (Garage bucket/key helper), `test/setup.ts`, `packages/repl/cmd.ts`, `environments/data/kv.json` (drop `**objectEndpoint**`), `packages/components/config/variables/s3.json` (reduce to `s3Region`) |

## Open items

- Confirm the exact `/v2` shapes for the pinned `dxflrs/garage:v2.2.0`
  (field names, error codes for "already exists").
- Key idempotency: deterministic `name` + `ListKeys` lookup, or record-driven
  find-first (is the record written before or after creation?).
- Orphan reconciliation: a reconcile activity (like `reconcileActivities`) that
  drops buckets/keys with no endpoint record and vice versa.
- Bucket/key deletion on account deletion (no account-deletion flow exists).
- **Retire `sai-dev` / `CSS_S3_BUCKET`** (and the single-`S3DataAccessor` wiring)
  once every data pod is provisioned from its record.
- Production Nix/podman wiring for the Garage admin token
  (`production-consumer-cleanup.md`).

## Sequencing

1. `GarageAdminClient` + `RoutedS3DataAccessor` (record consumption) with unit
   tests; keep the temporary `sai-dev` records only long enough to exercise it.
2. Worker env/binding (`CSS_GARAGE_ADMIN_TOKEN`, `garage`).
3. Move account creation into the Temporal workflow (Fuseki + Garage + records +
   TriG) with find-first + compensation.
4. Seed per-pod buckets/keys (fixture + `packages/repl`).
5. Retire `sai-dev` / `CSS_S3_BUCKET` and the single-`S3DataAccessor` wiring;
   add the key-scoping `/test` cases.

## References

- [`fuseki-per-pod-sparql.md`](fuseki-per-pod-sparql.md) — the typed
  `objectEndpoint` records and the SPARQL-plane routing this mirrors.
- `isolated-datasets-and-sparql.md` 4b — the per-pod isolation contract.
- `federation.md` — the single-deployment shortcuts.
