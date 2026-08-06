# Test infrastructure consolidation

> Extracted from **Phase 6** of [`refactor-data-model.md`](refactor-data-model.md) (the Phase 5 rework now points here). Independent from Phases 1–5 of that plan and can land any time (before, after, or parallel to them). It touches **no data-model code** — only fixtures, test servers, and where tests live. Its two goals: (1) delete the file-backed data-pod fixtures (`packages/css-storage-fixture/test/data/` and `dev/data`) and the S3 client-id seeding in `test/setup.ts`, and (2) stop starting a live CSS server from package tests (`@janeirodigital/css-test-utils` `SolidTestUtils`), moving those integration-style tests to the root `test/` directory with `packages/css-storage-fixture/test/registry.trig` as the single fixture source.

Doing it first **narrows Phase 5's scope** (only the mock realm `data.json` needs converting — done in the Phase 5 rework; `registry.trig` stays Turtle regardless — the quadstore-backed CSS content-negotiates JSON-LD on request) and **makes the per-phase gate of Phases 1–4 server-free** (most relevant to Phase 2, which rewrites the `Application`/`DataOwner` APIs that `application.test.ts` currently exercises against a live CSS).

## Current topology (two fixture realms)

| Realm | Location | Server? | Consumers |
|-------|----------|---------|-----------|
| **Mock** | `packages/test-utils/src/data.json` + `fetch-mock.ts` | none (in-memory fetch mock) | data-model, authorization-agent, components unit tests — **stays** (JSON-LD since the Phase 5 rework) |
| **CSS server** | `packages/css-storage-fixture/test/` (pods `data/`, `solid/`, `luka/`, `vaporcg/`, … + `.internal/` accounts) | in-process CSS on `:3711` via `SolidTestUtils` (`packages/css-test-utils`) | package tests: `application/test/application.test.ts`, `utils/test/discovery.test.ts`, `repl/test/cli.test.ts` |
| **CSS server** | `packages/css-storage-fixture/dev/` (`dev/data`, `dev/pod`) | docker `data`/`auth` services + `registry` CSS (oxigraph) | root `test/*.ts` (docker stack): `setup.ts` seeds `registry.trig` → oxigraph, `kv.json` → Postgres, client id → garage S3 |

Key facts:

- `registry.trig` (loaded into oxigraph by `test/setup.ts`) **already serves 210 `https://data/...` resources** — data registries (`acme-rnd`, `acme-hr`, `alice-work`, …), instances, and even `test-client/public/access-needs`. The file-backed pods add only two things under `https://data/`: the **client id document** (`test/data/test-client/public/id$.jsonld`, currently uploaded to garage S3) and the **shapetrees pod** (`test/data/shapetrees/` + `dev/data/shapetrees/`).
- The in-process CSS server lives in `packages/css-test-utils` (not `packages/test-utils`); `test-utils` has no server, only the mock fetch + Postgres client.
- `test/data` and `dev/data` **differ** (real drift — e.g. `bob`/`www` only in `dev`, differing shex/ttl contents).
- `test/solid/trees/` (Widget/Gadget) + the `solid/`/`luka/`/… pods are a separate realm (`localhost:3711`, `solidshapes.example`) used only by the package-CSS tests; they move with those tests or get deleted with `css-test-utils`.

## Steps

1. **Move the data-pod resources into `registry.trig`** as named graphs (client id doc + `shapetrees/` trees/shapes/descriptions), so the oxigraph-backed `registry` CSS serves everything under `https://data/...`. Check `data/shapetrees/*.ttl` for blank nodes before the move (oxigraph handles them; the earlier `uuid:` blank-node concern was in the *mock* `data.json`, a different realm).
2. **`test/setup.ts`** — drop the garage S3 client-id upload (`garage.putAnyObject`/`deleteObject`); the client id is served from the quadstore.
3. **Move server-backed package tests to root `test/`**: `application.test.ts` server blocks (`describe.skip`-gated today), `utils/test/discovery.test.ts`, `repl/test/cli.test.ts`. Keep/extend the mock-based unit tests in the packages (`statelessFetch` pattern already used by `application.test.ts`) so each package keeps a server-free gate.
4. **Delete** `packages/css-storage-fixture/test/data/`, `dev/data` (check `bob`/`www` usage first), the docker `data` service if nothing file-backed remains under `https://data/`, the `.internal/` account state (if the package-CSS realm goes away), and `packages/css-test-utils` if fully unused.

## Stays as-is (boundary)

- **Mock realm** — `data.json` + `fetch-mock.ts` stay for package unit tests (JSON-LD since the Phase 5 rework).
- **`registry.trig` stays Turtle** — the quadstore seed format is independent of the client wire format; the CSS serves JSON-LD via content negotiation after Phase 5.
- **kv.json → Postgres** seeding in `setup.ts` stays (temporal workflow state).
- Widget/Gadget shape trees stay in the CSS realm while the package-CSS tests still use them.

## Verify

- Package tests (`application`, `utils`, `repl`) run **server-free** (mock fetch only).
- Root integration tests (`test/*.ts`) pass against the docker stack with `registry.trig` serving the moved resources.
- `packages/css-storage-fixture/test/data/` and `dev/data` removed; no references to `SolidTestUtils` remain.
