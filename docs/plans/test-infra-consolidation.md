# Test infrastructure consolidation

> Extracted from **Phase 6** of [`refactor-data-model.md`](refactor-data-model.md) (the Phase 5 rework now points here). Independent from Phases 1–5 of that plan and can land any time (before, after, or parallel to them). It touches **no data-model code** — only fixtures, test servers, and where tests live. Its two goals: (1) delete the file-backed data-pod fixtures (`packages/css-storage-fixture/test/data/` and `dev/data`) and the S3 client-id seeding in `test/setup.ts`, and (2) remove the in-process CSS server + `@janeirodigital/css-test-utils` entirely — the live `discovery` test moves to root `test/` as an integration test against the docker stack, the rest of the server-touching tests become mocks or are deleted, and `packages/css-storage-fixture/test/registry.trig` stays the single fixture source.

Doing it first **narrows Phase 5's scope** (only the mock realm `data.json` needs converting — done in the Phase 5 rework; `registry.trig` stays Turtle regardless — the quadstore-backed CSS content-negotiates JSON-LD on request) and **makes the per-phase gate of Phases 1–4 server-free** (most relevant to Phase 2, which rewrites the `Application`/`DataOwner` APIs that `application.test.ts` currently exercises against a live CSS).

## Current topology (two fixture realms)

| Realm | Location | Server? | Consumers |
|-------|----------|---------|-----------|
| **Mock** | `packages/test-utils/src/data.json` + `fetch-mock.ts` | none (in-memory fetch mock) | data-model, authorization-agent, components unit tests — **stays** (JSON-LD since the Phase 5 rework) |
| **CSS server** | `packages/css-storage-fixture/test/` (pods `data/`, `solid/`, `luka/`, `vaporcg/`, … + `.internal/` accounts) | in-process CSS on `:3711` via `SolidTestUtils` (`packages/css-test-utils`) | package tests: `application/test/application.test.ts`, `utils/test/discovery.test.ts`, `repl/test/cli.test.ts` |
| **CSS server** | `packages/css-storage-fixture/dev/` (`dev/data`, `dev/pod`) | docker `data`/`auth` services + `registry` CSS (oxigraph) | root `test/*.ts` (docker stack): `setup.ts` seeds `registry.trig` → oxigraph, `kv.json` → Postgres, client id → garage S3 |

Key facts:

- `registry.trig` (loaded into oxigraph by `test/setup.ts`) **already serves 210 `https://data/...` resources** — data registries (`acme-rnd`, `acme-hr`, `alice-work`, …), instances, and even `test-client/public/access-needs` plus the shapetrees **trees/descriptions** (`Project`/`Task`/`File`/`Image`, `desc-en/es/pl` — identical content to the file copies). The only file-backed resource left under `https://data/` is the **client id document** (`test/data/test-client/public/id$.jsonld`, currently uploaded to garage S3). The `.shex` **shape documents are deleted, not moved** — nothing fetches them (`ShapeTreeData.shape` is just an IRI string; no ShEx parser or `@shapetrees/*` dependency anywhere in the repo) and the quadstore can't hold them anyway (non-RDF; the hybrid accessor routes non-quads to S3, so they're unserved today).
- The in-process CSS server lives in `packages/css-test-utils` (not `packages/test-utils`); `test-utils` has no server, only the mock fetch + Postgres client.
- `test/data` and `dev/data` **differ** (real drift — e.g. `bob`/`www` only in `dev`, differing ttl contents; the `.shex` shapes are deleted outright, so their drift is irrelevant).
- `test/solid/trees/` (Widget/Gadget) + the `solid/`/`luka/`/… pods are a separate realm (`localhost:3711`, `solidshapes.example`) used by the package-CSS tests **and the repl CLI source** (`cli.ts`/`repl.ts` boot it via `SolidTestUtils`); it's deleted with `css-test-utils` in step 3.

## Steps

1. **Remove the `.shex` shape documents outright** — delete `test/data/shapetrees/shapes/` + `dev/data/shapetrees/shapes/` and the dangling `meta:https://data/shapetrees/shapes/*` graphs in the trig (`Project`/`Task`/`Image`/`File`). The shapes are non-RDF, so they can't live in the quadstore (the hybrid accessor routes non-quads to S3, where nothing uploads them), and no code fetches them — `ShapeTreeData.shape` is just an IRI string, with no ShEx parser or `@shapetrees/*` dependency anywhere in the repo. Same for the file-only `Event`/`Role`/`cg-en` trees: unreferenced, drop them rather than move them. Also drop the two dead shape snippets in the mock `data.json` (`https://solidshapes.example/shapes/Project|Task`) and point the `fetch-mock.test.ts` tests using them at any other existing key (they only use them as generic snippet keys).
2. **Clean up `repl`** — delete the css-test-utils-dependent entrypoints: `cli.ts`, `repl.ts`, and `test/cli.test.ts` (+ its `test/services/` MockConsole/MockTerminal helpers) — `buildSession` in `cli.ts`/`repl.ts` boots the in-process CSS via `new SolidTestUtils(account)`, and `cli.test.ts` only tests `mainPrompt` from the deleted `cli.ts`. Drop the `repl`/`cli` npm scripts and the `@janeirodigital/css-test-utils` devDependency. **Keep `cmd.ts` + `add-user.ts`** — they don't depend on css-test-utils (interop packages only) and `cmd.ts` already imports `addUserCommand` from `./add-user.js`.
3. **Remove `@janeirodigital/css-test-utils` and the localhost:3711 realm** — remaining consumers and per-file changes:
   - `application/test/application.test.ts` (imports `SolidTestUtils, accounts, inspector, shapeTree`) — all usage is confined to the `describe.skip('describe discovery')` block (never runs) plus the `beforeAll`/`afterAll` server boot. Drop the import, the server hooks, and the skipped block — its APIs are rewritten in Phase 2 anyway; the two mock-based describes (`statelessFetch`) stay as the package's server-free gate.
   - `utils/test/discovery.test.ts` (imports `SolidTestUtils, accounts, host`) — the live `discoverStorageDescription` test is **converted into a root integration test** (`test/`), run via dagger (`.dagger/src/index.ts`) against the docker stack with `registry.trig` data: HEAD a storage resource (e.g. `https://data/acme-rnd/` or `https://registry/acme/`, authenticated with the `buildOidcSession` pattern from `agent-discovery.test.ts`) and expect the `storageDescription` Link header — the sai stack already wires the storage-description handler/advertiser via `sai:config/http/handler/default.json`, and `registry.trig` marks the storages (`space:Storage`). Once step 4 lands, the same test can exercise the client-id discovery fns (`discoverAuthorizationRedirectEndpoint`/`discoverWebPushService`) against `https://data/test-client/public/id` served from the quadstore. The mock-based discovery tests (`statelessFetch`) stay in the package as the server-free gate.
   - Delete the package; drop the devDependency from `application`, `utils` (repl's was dropped in step 2); drop the `css:test` script in `css-storage-fixture` (it launches this realm).
   - Delete the realm data: `test/solid/`, `test/luka/`, `test/vaporcg/`, `test/.internal/` — account + IdP state keyed to `localhost:3711` (the docker auth stack keeps its own state in Postgres + env JWK).
4. **Move the client id document into `registry.trig`** as a named graph — it's JSON-LD, so express it as RDF (solid:oidc + interop terms) and let the quadstore-backed CSS serve it back as JSON-LD via content negotiation. **Remove the `ma:format "application/ld+json"` triple** from the existing `meta:https://data/test-client/public/id` graph — otherwise the hybrid accessor keeps routing the resource to S3 (which will no longer have it) instead of the quadstore. The shapetrees **trees/descriptions are already in the trig** (identical to the file copies — nothing to move).
5. **`test/setup.ts`** — drop the garage S3 client-id upload (`garage.putAnyObject`/`deleteObject`); the client id is served from the quadstore.
6. **Delete** `packages/css-storage-fixture/test/data/` (now just the client id — moved in step 4), `dev/data` (check `bob`/`www` usage first), and the docker `data` service if nothing file-backed remains under `https://data/`.

## Stays as-is (boundary)

- **Mock realm** — `data.json` + `fetch-mock.ts` stay for package unit tests (JSON-LD since the Phase 5 rework).
- **`registry.trig` stays Turtle** — the quadstore seed format is independent of the client wire format; the CSS serves JSON-LD via content negotiation after Phase 5.
- **kv.json → Postgres** seeding in `setup.ts` stays (temporal workflow state).
- Widget/Gadget shape trees stay in the CSS realm while the package-CSS tests still use them; their `.shex` documents aren't fetched (same as the data-realm shapes) and go away with the realm.

## Verify

- Package tests (`application`, `utils`) run **server-free** (mock fetch only); `repl` keeps only `cmd.ts`/`add-user.ts` and no package tests.
- Root integration tests (`test/*.ts`) pass against the docker stack with `registry.trig` serving the moved resources — including the client id at `https://data/test-client/public/id` served as JSON-LD from the quadstore.
- `packages/css-storage-fixture/test/data/` and `dev/data` removed; no references to `@janeirodigital/css-test-utils` remain (tests or repl source).
- `https://data/shapetrees/shapes/*` 404s are expected (no consumer); the shape **trees** (`https://data/shapetrees/trees/*`) still resolve from the quadstore.
