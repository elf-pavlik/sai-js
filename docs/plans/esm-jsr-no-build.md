# ESM-only, no build step, tsgo typecheck (Node 26 runtime)

> **Status:** ✅ **complete** — all in-scope phases implemented (0–4, 7, 8, 10).
> The deferred follow-ups were split into their own plans:
> [`production-consumer-cleanup.md`](production-consumer-cleanup.md) (Phase 5),
> [`npm-publishing.md`](npm-publishing.md) (Phase 6 + §6 + the publishing
> decisions D4/D6/D7/D8), and
> [`extract-temporal-workflows.md`](extract-temporal-workflows.md) (Phase 9).
>
> This plan tracked the move of the publishable packages to **ESM-only source
> with no build step**, running **everything under a native-TS runtime** (incl.
> production OCI images), and type-checking with **`tsgo --noEmit`**
> (`@typescript/native-preview`).
>
> **Revision — runtime reverted to Node 26.** The original resolution ran
> everything under **Bun**; that was later reversed. Everything now runs under
> **Node 26** (native `.ts` strip-only mode), vitest runs under Node, and the
> Bun-only jose `preload.cjs` workaround was removed. Two strip-only fixes were
> needed in the no-build sources: parameter properties and one `enum`. The
> no-build tsconfig also moved from `module: preserve` + `moduleResolution:
> bundler` to **`nodenext`** for the no-build packages (`components` keeps
> `esnext`/`bundler`). Publishing is now tracked under npm in
> [`npm-publishing.md`](npm-publishing.md) (the JSR plan was dropped).

## 1. Goal

1. **ESM-only.** Drop the dual CJS/ESM rollup output; packages are `"type": "module"` and expose TypeScript source.
2. **No build step** for the interop library packages (and, where feasible, everything else).
3. **Dev/test on Node 26** loading `.ts` natively (strip-only mode).
4. **Typecheck with `tsgo --noEmit`.**
5. **Publish packages to npm** under `@hackers4peace` — **split out to [`npm-publishing.md`](npm-publishing.md)**; not part of this plan.

## 2. Current state (evidence)

### 2.1 Repo shape

- npm workspaces: `packages/*`, `test`, `docs/website`; Turbo orchestrates `build`/`test`/`dev`/`clean`.
- Publishable packages:
  - **5 interop libs** built by rollup (`@inrupt/base-rollup-config`) into dual CJS (`dist/index.js`) + ESM (`dist/index.mjs`): `interop-utils`, `interop-data-model`, `interop-application`, `interop-authorization-agent`, `sai-api-messages`.
  - **`@elfpavlik/sai-components`**: `tsc` + `componentsjs-generator`; Components.js `lsd:*` fields pointing at `dist/`.
  - private: `interop-repl`, `interop-test-utils`.
- `tsconfig.base.json`: `module: ESNext`, `moduleResolution: node` (node10), per-package `composite: true`, `outDir: dist`.
- Only `repl` and `test-utils` currently have `"type": "module"`.
- Relative imports are mixed: **139 with `.js` extension**, **189 extensionless**.
- No `jsr.json`/publish workflow; no changesets/release tooling.
- Each interop package already has `LICENSE` + `README.md`; `components` has neither.

### 2.2 Validated facts

| Fact | How verified |
|---|---|
| Bun resolves both `./x` and `./x.js` → `x.ts` | probe |
| `bunx --bun vitest run` passes existing tests | ran `packages/utils/test/link-header.test.ts` |
| Node **cannot** type-strip `.ts` in `node_modules` (`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`) | probe on Node 24.21 |
| `tsgo` = `@typescript/native-preview` (bin `tsgo`); 7.0.0-dev | `npx tsgo --version` |
| `tsgo` removed `moduleResolution: node10` (`TS5108`) | ran on every package |
| `tsgo` defaults to **`strict: true`** | probe (`--strict false` clears the error) |
| JSR **requires `jsr.json`** (package.json alone rejected) | `jsr publish --dry-run` probe |
| JSR enables sloppy imports at publish (`--unstable-sloppy-imports`) | CLI invocation shown on error |
| JSR package name limit is currently **58** chars (docs' "20" is outdated) | `jsr.io/docs/packages` |
| npm + Bun cannot install `jsr:` dependency specifiers | Bun treats it as a git URL |
| Slow-type violations per package (see table below) | `jsr publish --dry-run --allow-dirty` |

### 2.3 `tsgo --noEmit` baseline (with `moduleResolution: bundler`)

| Package | errors |
|---|---|
| `utils` | 9 |
| `data-model` | 9 |
| `application` | 21 |
| `authorization-agent` | 11 |
| `sai-api-messages` | 0 |
| `components` | 68 |
| `test-utils` | 2 |
| `repl` | 1 |
| **total** | **~121** |

Most are strict-mode null/undefined issues (`TS2322`, `TS2532`, `TS18048`, …), i.e. surfaced by tsgo's `strict: true` default, not by the resolution change.

### 2.4 JSR slow-type violations

| Package | violations | notes |
|---|---|---|
| `utils` | 24 | 14 missing explicit type, 10 missing return type |
| `data-model` | 0 | dry run clean |
| `application` | 0 | dry run clean |
| `authorization-agent` | 3 | missing return type |
| `sai-api-messages` | 92 | 65 missing explicit type + **27 `unsupported-super-class-expr`** (`effect/Schema` class expressions) |
| `components` | 14 | missing explicit type |

### 2.5 Consumers affected by no-build

- `test/` integration tests import workspace packages + `@elfpavlik/sai-components`; they run under vitest (Bun-compatible), but the CSS/temporal services they talk to run under **Node** and consume built dist (`packages/components/dist/workers/main.js`, CSS `lsd:*`).
- `services/id` already runs `.ts` directly under Node with explicit `.ts` imports, but imports workspace packages that currently resolve to built dist.
- `docker-compose.yaml` and `.dagger/src/index.ts` hardcode `node` + `dist` paths.
- `ui/authorization` (Vite) and `docs/website` (Astro) handle TS `exports` fine.

### 2.6 The central tension

Node cannot load `.ts` from `node_modules`. Pointing package `exports` at `src/index.ts` therefore works for Bun and Vite, but **breaks every Node process** that imports those packages by name (CSS servers, Temporal worker, dagger services, production containers) unless they run under Bun or consume a transpiled build. This drives decisions D1 and D5.

## 3. Decisions

Each decision is listed with options, a recommendation, and a placeholder for the resolution. **Decisions are resolved one at a time before implementation starts.**

| # | Decision | Recommendation | Status |
|---|---|---|---|
| D1 | `@elfpavlik/sai-components` strategy | keep on npm with its build | ✅ **A** — keep on npm with its build |
| D2 | TypeScript strictness under tsgo | `strict: true` migration (~121 fixes) | ✅ **B** — pin `strict: false` now; **Phase 7** migrates to `strict: true` |
| D3 | Module/resolution mode + import extensions | `module: preserve` + `moduleResolution: bundler` + explicit `.ts` imports | ✅ **A** — `module: preserve` + `moduleResolution: bundler`; imports stay mixed; normalization deferred to **Phase 8** |
| D4 | JSR cross-package dependency specifiers | publish-time rewrite to `jsr:` | ⛔ dropped — JSR plan removed; see [`npm-publishing.md`](npm-publishing.md) |
| D5 | Production runtime for CSS/worker/services | pending D1 | ✅ **A** — Node 26 everywhere, including the production OCI images in `flake.nix` (originally resolved as Bun; reverted — see the revision note) |
| D6 | npm publishing | keep npm for `components` only (per D1) | ↪ superseded — see [`npm-publishing.md`](npm-publishing.md) |
| D7 | Slow types | fix utils/auth-agent/components; `--allow-slow-types` for `api-messages` | ⛔ dropped — JSR plan removed; see [`npm-publishing.md`](npm-publishing.md) |
| D8 | JSR publish trigger + version source of truth | GitHub Actions on release, `jsr.json`/`package.json` synced by script | ⛔ dropped — JSR plan removed; see [`npm-publishing.md`](npm-publishing.md) |
| D9 | Test runner runtime | keep vitest, run under Node | ✅ **A** — keep vitest, run under Node 26 (originally `bunx --bun`; reverted) |
| D10 | npm publish/release behavior while publishing is deferred | keep npm releases via a publish-time build; no build in dev/test | ✅ **B** — pause npm releases for the 5 interop libs; only `components` keeps publishing |

### D1 — `@elfpavlik/sai-components` strategy

**Context.** The package is not a normal library: CSS loads it through Components.js `lsd:components`/`lsd:contexts`/`lsd:importPaths` package.json fields, and `componentsjs-generator` needs compiled output to emit the per-class `dist/components/*.jsonld` descriptors. A run of the generator against `src/*.ts` produced only `components.jsonld`/`context.jsonld` (the per-class definitions, which carry `requireElement` metadata, are not produced), and JSR's npm-compat layer cannot be assumed to preserve `lsd:*`.

**Options**
- **A. Keep `components` on npm with its build** (`build:ts` + `build:components`) — everything else goes no-build. Lowest risk; documented exception.
- **B. Commit generated descriptors** — generate once, point `lsd:*` at committed files, treat as generated-but-checked-in. Still needs compiled JS for `requireName` unless runtime is Bun.
- **C. Programmatic CSS wiring** — replace declarative Components.js config with a TS CSS config loaded by Bun, dropping the descriptors. Largest refactor; upstream CSS shape must be supported.

**Recommendation:** A now; C as a possible follow-up if/when the whole server stack runs under Bun.

**Resolution:** ✅ **A** — `@elfpavlik/sai-components` keeps `build:ts` + `build:components`, its `dist/` + `lsd:*` fields, and stays an npm package. It is the sole build-step package. Revisit C only if CSS later runs under Bun.

### D2 — TypeScript strictness under tsgo

`tsgo` enforces `strict: true` by default, surfacing ~121 pre-existing errors.

**Options**
- **A. Migrate to `strict: true`** — fix the ~121 errors (mostly null/undefined guards). Cleanest long-term; largest diff.
- **B. Pin `strict: false` (+ `strictNullChecks: false`)** to preserve current behavior now; ratchet later.
- **C. Hybrid** — enable strict per package as it goes green (e.g. `api-messages` first, `components` last).

**Recommendation:** A for the 5 interop libs (they are the published surface), C for `components`; B as the fallback if the migration stalls.

**Resolution:** ✅ **B** — pin `"strict": false` (and `strictNullChecks: false`) in `tsconfig.base.json` so `tsgo --noEmit` matches today's behavior. `components` keeps its existing `tsc` pipeline (per D1). Migrating to **A** (`strict: true`, ~53 errors in the 5 libs + `test-utils`/`repl`; ~68 more in `components`) is deferred to **Phase 7**, to be tackled only after all other phases are complete and verified.

### D3 — Module/resolution mode + import extensions

`moduleResolution: node10` is gone in tsgo.

**Options**
- **A. `module: "preserve"` + `moduleResolution: "bundler"` + `allowImportingTsExtensions: true`** — matches Bun/Vite; accepts extensionless and `.js` imports.
- **B. `module`/`moduleResolution: "nodenext"`** — Node-correct; requires explicit extensions and `allowImportingTsExtensions`.
- Do we normalize all relative imports to explicit `.ts`? Mechanical (~145 files), needed for Node native TS, recommended by JSR, but not strictly required for Bun/JSR sloppy imports.

**Recommendation:** A, and normalize to explicit `.ts` as a separate mechanical step (enables Node native TS and removes ambiguity).

**Resolution:** ✅ **A** — `module: "preserve"` + `moduleResolution: "bundler"` + `allowImportingTsExtensions: true`. To keep the initial diff small, the existing mixed imports (`.js` + extensionless) are left as-is; `bundler` resolves all three. Normalizing every relative import to explicit `.ts` is deferred to **Phase 8** (same pattern as D2 → **Phase 7**).

> **D4, D6, D7, D8** (all JSR-related) are dropped with the JSR plan; see
> [`npm-publishing.md`](npm-publishing.md).

### D10 — npm publish/release behavior while publishing is deferred

Surfaced by deferring publishing (D4): the interop libs become TS-source-only with no
`dist` in dev/test, but they are still `@janeirodigital/*` npm packages. A plain
`npm publish` would ship TS source, which Node consumers cannot load from
`node_modules`.

**Options**
- **A. Publish-time build only** — dev/test run source TS under Bun with no build;
  the `publish`/`prepublishOnly` script still builds `dist` (rollup or `tsc`)
  just for the npm tarball. "No build step" applies to the dev/test loop.
- **B. Pause npm releases** for the interop libs until npm publishing lands.
  No build at all; `components` (D1) keeps building/publishing.
- **C. Publish TS-only to npm** — simplest pipeline, breaks Node consumers.
  Rejected.

**Recommendation:** A if there are external npm consumers that must keep
working; B if the packages are consumed only inside this repo until npm publishing.

**Resolution:** ✅ **B** — pause npm releases for the 5 interop libs until npm
publishing lands. `@elfpavlik/sai-components` (D1) keeps its build + npm
releases. Consequences:

- The 5 interop libs have **no build and no publish script** — they are
  TypeScript source only.
- Anything that loads them from `node_modules` under **Node** breaks, because the
  package entry points at `src/index.ts` and Node cannot type-strip in
  `node_modules`. This includes `components`' emitted `dist/*.js`, the CSS
  servers, the Temporal worker, and the nix/production images. **This makes D5
  decisive** — see below.

### D5 — Production/Node runtime for CSS/worker/services

Depends on D1 and D10.

**Context.** With D10 = B, workspace interop packages are TS-only. Any Node
process that imports them by name from `node_modules` fails. Consumers:
`components`' built `dist/*.js` (imports interop), the CSS servers, the Temporal
worker, `services/id`, and the nix/production images. Local dev/test is fine on
Bun; the question is what the servers (and production) run.

**Options**
- **A. Run the Node-facing services under Bun** (CSS + Temporal worker +
  `components` workers) so they can load TS source/workspace packages. Needs a
  feasibility spike for `@solid/community-server` and `@temporalio/worker` under
  Bun; still needs the generated Components.js descriptors.
- **B. Consume frozen npm releases** for the servers/production — i.e. the last
  published (built) interop versions. Servers keep running under Node; they just
  do not see new interop code until npm publishing. Local dev of the interop libs is Bun-only.
- **C. Split dev vs production** — dev servers run under Bun on source; the
  production/nix images keep installing built npm releases (frozen per B).

**Recommendation:** C if Bun cannot cleanly run CSS/Temporal; otherwise A. B
alone is the floor (production frozen until npm publishing).

**Resolution:** ✅ **A** — Bun is the runtime everywhere: dev, test, and the
production OCI images built from `flake.nix`. There is no Node runtime story to
maintain. Implications:

- A **Bun feasibility spike** for `@solid/community-server` + the generated
  Components.js descriptors and `@temporalio/worker` is now a required early
  task (Phase 3). If either fails under Bun there is no fallback left, so this
  must be validated before the no-build cutover.
- The nix packages/images (`nix/packages/sai-*.nix`, `nix/images/sai-*.nix`)
  currently use `pkgs.nodejs` + `buildNpmPackage` against published npm deps and
  run built `dist`; they must be reworked to ship the repo source and use Bun —
  see [`production-consumer-cleanup.md`](production-consumer-cleanup.md).
- Production no longer depends on npm releases, which is consistent with
  D10 = B.

### D9 — Test runner under Node

**Options**
- **A. Keep vitest, run under Node 26** (`npx vitest run`) — verified working.
- **B. Migrate to `node --test`** — tests import from `vitest`, so this needs a compatibility shim or a large rewrite.

**Recommendation:** A.

**Resolution:** ✅ **A** — keep vitest, run under **Node 26** (`npx vitest run`).
(The plan originally resolved this as the Bun runtime via `bunx --bun`; reverted
together with D5.)

## 4. Verification & phased implementation plan

> All decisions resolved (D4/D6/D7/D8 dropped with the JSR plan; see
> [`npm-publishing.md`](npm-publishing.md)).
> **Verification is the organizing principle:** the runtime switch must land
> before the no-build switch, so `dagger call test` stays runnable throughout.

### 4.1 Verification gates (run after every phase)

Prerequisites: workspace deps installed (`npm install`, so workspace symlinks are
in place) and — until Phase 4 — `packages/components/dist` built
(`npm run build:components`, or the full `npm run build`). G3 is user-run.

| Gate | Command | Notes |
|---|---|---|
| **G1 — unit tests** | `npx vitest run` | Runs vitest under **Node 26**. **Green: 70/70 files, 298 passed, 0 failed.** |
| **G2 — typecheck** | `npx tsgo --noEmit -p packages/<pkg>/tsconfig.json` (or a root `typecheck` script) | Activates in **Phase 2**. Before that, the `tsc` build is the de-facto type gate. |
| **G3 — integration** | `dagger call test` | Runs `test/` against the CSS + worker + id services. Requires `packages/components/dist`. User-run. |

**Baseline (Phase 0):** on the current tree run `npm install`, `npm run build`,
then G1 and G3. `dagger call test` is already runnable *now* — the job here is to
keep it green while the tree changes.

### 4.2 Why this order

No-build only works where TS is loaded natively (Node 26 / Bun). So the
**runtime switch must land before package `exports` move to `src/*.ts`**.
Phase 1 switched the dagger/dev/test services to a native-TS runtime (Bun at the
time; later reverted to Node 26) while the interop packages were still built
(`dist` present), which is what let `dagger call test` stay green through every
later phase.

### Phase 0 — baseline (no changes)

- Run and record: `npm install && npm run build`; G1; G3 (`dagger call test`).
- Confirm the exact `dagger call test` invocation and any env it needs.

### Phase 1 — Bun runtime for dagger / dev / test (packages still built) — ✅ implemented

Goal: **G3 runs under Bun before any no-build change.**

- ✅ `.dagger/src/index.ts`: added `BUN_IMAGE = 'oven/bun:1.4.2-slim'` (glibc, to
  match the host `node_modules` + Temporal native addon) and switched every
  node service/test container to it:
  - CSS: `bun --preload=…/preload.cjs …/bin/server.js` (Node `--require` → Bun
    `--preload`).
  - worker: `bun --inspect=… /sai/packages/components/dist/workers/main.js`
    (dist still exists this phase).
  - id: `bun --preload=… services/id/https.ts`.
  - proxy: `bun /proxy.js`.
  - test/debug containers: `bun run dagger:test` / `dagger:debug`.
- ✅ `test/package.json`: `dagger:test` → `bunx --bun vitest run --no-file-parallelism`;
  `dagger:debug` → `bun --inspect-brk=0.0.0.0:9240 ../node_modules/vitest/vitest.mjs …`
  (the test suite has no `vi.mock`, so Bun runtime is safe here).
- ✅ `docker-compose.yaml`: auth/registry/data/worker/id → `oven/bun:1.4.2-slim`
  with Bun commands. `ui`/`vuejectron` (Vite dev servers) left on Node for now —
  not on the critical path.
- ✅ `packages/repl`: `cmd` → `bun ./cmd.ts`; dropped the `tsx` devDependency.
- ✅ G1 needed no hermetic env fix after all: `bunx vitest run` (Node runtime) is
  already 70/70 green with no manual env.
- Interop `dist` + rollup stay in place this phase.
- **Validated:** `npx tsc --noEmit -p .dagger/tsconfig.json` clean;
  `docker compose config` valid; G1 green; `bun packages/repl/cmd.ts --help` runs.
- ✅ **Bun/jose compatibility fix (found by G3):** under Bun, jose 5.x resolves
  its `"bun"` export condition to the **browser/WebCrypto** build. CSS's
  `CachedJwkGenerator` generates a key pair and exports the private key as a JWK;
  the WebCrypto build defaults `extractable: false` and cannot export Node
  `KeyObject`s, so it throws `non-extractable CryptoKey cannot be exported as a
  JWK` (observed as repeated `[ListeningActivityHandler]` webhook errors). Fix:
  `preload.cjs` now patches `Module._resolveFilename` **under Bun only**, scoped
  to `require('jose')` originating from `@solid/community-server`, redirecting it
  to that package's **node** build. Verified: `CachedJwkGenerator`
  `getPrivateKey`/`getPublicKey` succeed under Bun, Node is unaffected, and our
  own jose v6 usage is untouched. (Alternative if preferred later: wire
  `EnvJwkGenerator` for `urn:solid-server:default:JwkGenerator` on registry/data
  too — auth already does this.)
- ✅ **Test bug exposed by Bun's fetch:** `test/authorization.test.ts` sent a
  typo'd `ContentType` header instead of `Content-Type`. Node's fetch silently
  adds `Content-Type: text/plain;charset=UTF-8` for a string body, so CSS's
  `PostOperationHandler` accepted it; **Bun's fetch adds no `Content-Type`**, so
  CSS returned 400 (`POST requests require the Content-Type header`). Fixed the
  header to `Content-Type` (matches the other RPC calls).
- **Caveat for G3:** official `oven/bun` images may default to a non-root `bun`
  user; if a service fails writing to a mounted volume, add `user: root` in
  compose / `.withUser('root')` in the dagger containers.
- **Gate:** ✅ G1 green; ⏳ G3 (`dagger call test`) green under Bun — **user to run**.

### Phase 2 — tsgo typecheck setup (no runtime impact) — ✅ implemented

- ✅ `@typescript/native-preview@7.0.0-dev.20260707.2` devDep; root
  `typecheck` script: `tsgo --noEmit -p packages/<pkg>/tsconfig.json` for the 5
  interop libs + `test-utils` + `repl` (components excluded per D2 = B).
- ✅ `tsconfig.base.json`: `module: "preserve"`, `moduleResolution: "bundler"`,
  `allowImportingTsExtensions: true`, `noEmit: true`, `"strict": false`;
  dropped `declaration`/`declarationMap`/`sourceMap`/`removeComments`/
  `emitDecoratorMetadata`/`experimentalDecorators`/`noLib`.
- ✅ `components` and `test-utils` still emit, so they override
  `module: "esnext"`, `noEmit: false`, `allowImportingTsExtensions: false`.
- ✅ `packages/repl/tsconfig.json` fixed: it pointed at a non-existent `src/`
  (files are at the package root) — now `include: ["*.ts"]`.
- ✅ Fixed the pre-existing errors `tsgo` surfaced (all unrelated to strict):
  `utils/jsonld.ts` (`@types/jsonld` types `frame()`'s third arg as `Frame`, not
  `Options`), `authorization-agent/activity-registry.ts` (`ActivityData` union
  members without `target`; narrow with `'target' in activity`),
  `repl/cmd.ts` (string index into `mapPaths`).
- ✅ CI: added a `Typecheck` step before the build.
- **Validated:** `npm run typecheck` exit 0; G1 green; `npm run build -- --force`
  8/8 tasks OK (the rollup/tsc builds still work until Phase 3).
- **Gate:** ✅ G2 green; ✅ G1 unchanged; ⏳ G3 (`dagger call test`) — user to run.

### Phase 3 — ESM-only + no build (interop libs) — ✅ implemented

- ✅ Per lib (`utils`, `data-model`, `application`, `authorization-agent`,
  `api-messages`): `"type": "module"`; `main`/`types`/`exports` →
  `./src/index.ts` (dropped `module` + `require`/`import` conditions); removed
  `build`/`clean`/`publish` scripts; `files` → `["src/"]`; deleted the 5
  `rollup.config.mjs`; removed root `@inrupt/base-rollup-config` + `rollup`.
- ✅ Interop `tsconfig.json` simplified to `extends base` + `include: ["src"]`
  (dropped `composite`/`rootDir`/`outDir`; `data-model` keeps `typeRoots`).
- ✅ Removed stale interop `dist/` + `tsconfig.tsbuildinfo` — G1/G2 still green,
  proving nothing consumes them.
- ✅ **`test-utils` also converted to no-build** (later fix): its
  `main`/`types`/`exports` → `./src/index.ts`, build/clean scripts removed, and
  its `tsconfig` simplified. This was required because CI runs `typecheck`
  **before** `build`, and `packages/repl` imports
  `@janeirodigital/interop-test-utils` — whose types pointed at the not-yet-built
  `dist/` (`TS2307`).
- **`turbo.json` unchanged (deviation from the draft):** `components` (D1) still
  has a build script, so the `build` task and root `npm run build` stay; interop
  packages and `test-utils` are simply skipped by turbo.
- **Validated:** G2 exit 0; G1 70/70 files / 298 passed (Bun + Node); `npm test`
  (turbo) 7/7; `npm run build -- --force` 2/2 (components + docs-website) with no
  interop/`test-utils` `dist`; `npm run check` green.
- **Gate:** ✅ G1 + G2 green; ⏳ G3 (`dagger call test`) — user to run.

### Phase 4 — components exception (keep build) — ✅ confirmed

Per D1: keep `build:ts` + `build:components`, `dist` + `lsd:*`, npm publishing.
Confirm `tsc` still resolves the now-TS interop packages and that the generated
`dist/components/*.jsonld` is unchanged in shape.

- **Gate:** G1 + G3 green; `components` is still excluded from G2 (D2 = B).

> **Phase 5** (production + consumer cleanup) was split into its own plan:
> [`production-consumer-cleanup.md`](production-consumer-cleanup.md).
>
> **Phase 6** (publishing) was split into its own plan:
> [`npm-publishing.md`](npm-publishing.md).

### Phase 7 — strict-mode migration (follow-up) — ✅ implemented (components still excluded)

- ✅ Flipped `tsconfig.base.json` to `"strict": true` (dropped the now-redundant
  `noImplicitAny`). The CI `Typecheck` step (added in Phase 2) now enforces it.
- ✅ Fixed all errors in the 5 interop libs + `test-utils` + `repl` (~50):
  - `utils`: guards for `discoverAuthorizationAgent`/`discoverStorageDescription`;
    `@types/jsonld` overload casts; `FramedNode.id` made required (the frame
    always has an id — `frameNode` now throws if not).
  - `data-model`: `frameNode` id invariant + `jsonld.expand` cast.
  - `application`: definite-assignment on bootstrap fields; guards for
    parent/child map lookups; `?? false` on `can*` grants; `DataOwnerData |
    undefined`.
  - `authorization-agent`: `null` → `undefined` for quad matchers; definite
    assignment on `webIdProfile`/`registrySet`; `findDataRegistration` now
    returns `DataRegistrationData | undefined` (matching its test); guards +
    `?? null`/`?? undefined`.
  - `test-utils`: cast the mock response object as a whole; `sql!` definite
    assignment.
- ⏸️ **`components` remains `strict: false`** (its own tsconfig override) — the
  ~68 errors are still deferred, as the plan allowed. Its `tsc` build is
  unaffected, and it stays out of the G2 gate.
- **Validated:** G2 exit 0; G1 70/70 / 298 passed; `npm run build -- --force`
  3/3; `npm run check` green.
- **Gate:** ✅ G1 + G2 green; ⏳ G3 (`dagger call test`) — user to run.

### Phase 8 — normalize relative imports to `.ts` — ✅ implemented

- ✅ Codemodded every relative import/export in the **no-emit** packages
  (`utils`, `data-model`, `application`, `authorization-agent`, `api-messages`,
  `repl`): **46 files / 183 specifiers** (`.js` → `.ts`, extensionless → `.ts`).
- ✅ One directory import (`data-model/src/index.ts` `./templates`) was rewritten
  to `./templates/index.ts` (not `./templates.ts`).
- ✅ **Emitting packages** (`components`, `test-utils`) had to switch from
  `allowImportingTsExtensions: false` to `allowImportingTsExtensions: true` +
  `rewriteRelativeImportExtensions: true`, because they now pull `.ts`-specifier
  interop source into their program. Their **own** emitted specifiers stay `.js`
  (verified in `packages/components/dist/index.js`). `tsc -b` + `tsgo` both pass.
- **Validated:** G2 exit 0; G1 70/70 / 298 passed; `npm run build -- --force`
  3/3; `npm run check` green.
- **Gate:** ✅ G1 + G2 green; ⏳ G3 (`dagger call test`) — user to run.

> **Phase 9** (extract Temporal code; shrink `components` to Components.js-only)
> was split into its own plan:
> [`extract-temporal-workflows.md`](extract-temporal-workflows.md). It is not
> part of this plan.

### Phase 10 — Bun-runtime vitest compatibility — ✅ implemented

- ✅ **Upgraded `vitest` 3.2.4 → 5.0.3** — vitest 5 applies `vi.mock` under the
  Bun runtime (verified: 3.2.4 does not, 5.0.3 does).
- ✅ Replaced the deprecated `vitest.workspace.ts` (ignored by vitest 5, which
  then swept in the whole repo incl. `test/`) with a root `vitest.config.ts`:
  `test.projects: ['packages/*']`.
- ✅ Fixed the two now-fatal unawaited assertions in
  `packages/authorization-agent/test/agent-registry.test.ts`
  (`expect(...).rejects.toThrow(...)` → `await expect(...)`); vitest 3 only
  warned about these.
- **Validated:** `bunx --bun vitest run` (Bun) **70/70, 298 passed**;
  `bunx vitest run` (Node) also 70/70; `npm test` (turbo) 8/8; G2 exit 0;
  `npm run build -- --force` 3/3; `npm run check` green.
- **Gate:** ✅ G1 on the Bun runtime green; ⏳ G3 (`dagger call test`) — user to
  run (its container already uses `bunx --bun vitest`).
- **Note:** CI still runs `npm test` (turbo → Node-runtime vitest); adding Bun to
  CI to run `bunx --bun vitest` there is optional and not done here.

## 5. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Native-TS runtime cannot run CSS / Temporal worker | would have blocked the runtime story | ✅ **spike passed** (§8, run on Bun); the runtime was later reverted to Node 26, so the risk is moot |
| Strict-mode migration changes runtime behavior | null/undefined paths now guard/throw | ✅ fixed in Phase 7; G1 + G2 + build green |

Publishing-specific risks (slow types, npm-compat `lsd:*`, version divergence,
prerelease ranges) moved to [`npm-publishing.md`](npm-publishing.md).

## 6. Future work — npm publishing (deferred)

Moved to [`npm-publishing.md`](npm-publishing.md) — together with decisions
D4/D6/D7/D8 and the consumer-side facts.

## 7. Appendix — validation commands

```sh
# G1 — unit tests under Node (root, workspace = packages/*)
npx vitest run

# G2 — typecheck (activates in Phase 2)
npx -y -p @typescript/native-preview tsgo --noEmit -p packages/utils/tsconfig.json

# G3 — integration (user-run; needs packages/components/dist built)
npm run build -w @elfpavlik/sai-components   # or, until Phase 3: npm run build
dagger call test

# Node native TS
node packages/repl/cmd.ts --help
```

(The npm publish steps live in
[`npm-publishing.md`](npm-publishing.md).)

## 8. Bun feasibility spike results (D5, later reverted to Node 26) — ✅ passed

> Historical: this spike validated Bun as the runtime. The runtime was
> subsequently reverted to Node 26, so the results are retained for reference
> only.

Run against the tree at planning time (Bun 1.4.2, no source changes).

| Probe | Result |
|---|---|
| `@temporalio/worker` native core bridge under Bun | ✅ loads; `NativeConnection.connect('127.0.0.1:7233')` reaches TCP (`ECONNREFUSED` with no server) — N-API addon works |
| `bundleWorkflowCode({ workflowsPath: …/temporal/workflows/grants.ts })` under Bun | ✅ webpack 5.111.1 compiled a 1.67 MB bundle; works directly on **TypeScript source** |
| `@elfpavlik/sai-components` (built `dist`) import under Bun | ✅ 42 exports loaded |
| CSS `bin/server.js` under Bun, default `@css:config/file.json` | ✅ booted; `GET /` → **HTTP 200** |
| CSS + repo `environments/css/auth.json` (SAI components) under Bun | ✅ Components.js discovered 292 packages / registered 1176 components, instantiated the SAI component graph; stopped only at `PostgresKeyValueStorage` → `ECONNREFUSED 127.0.0.1:5432` (no local Postgres), with the stack trace going through `packages/components/dist/PostgresKeyValueStorage.js` |

**Caveats / follow-ups (not blockers):**

- `oidc-provider` prints `WARNING: Unsupported runtime. Use Node.js … LTS` under Bun. It is a soft warning and CSS still booted; watch it for OIDC flows.
- The dagger/compose commands used Node's `--require=…/tracing/preload.cjs`; Bun uses `--preload` (done in Phase 1). The nix images still need it — see [`production-consumer-cleanup.md`](production-consumer-cleanup.md).
- The spike did not run a live Temporal server or a full authenticated CSS flow; the external services (Postgres/SPARQL/garage/Temporal) were not started.
- Bun was validated; `bun test` vs vitest is still D9 = A (vitest under Bun).
