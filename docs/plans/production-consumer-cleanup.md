# Production + consumer cleanup (Node 26, no-build TS)

> **Status:** 📋 not started. Extracted from `esm-jsr-no-build.md` (where it was
> Phase 5) so that plan can close out.

## Goal

Make the production images and the remaining consumers run the **no-build
TypeScript source under Node 26**, consistent with the decisions already landed
in `esm-jsr-no-build.md`:

- **D5 = A** — Node 26 is the runtime everywhere (dev, test, **production OCI
  images**).
- **D10 = B** — the 5 interop libs have no build/`dist` and npm releases are
  paused; `@elfpavlik/sai-components` (D1) keeps its build + npm publishing.
- Node 26 strips `.ts` natively (strip-only mode) and resolves workspace
  packages through their symlinks (realpath outside `node_modules`). A real
  installed `node_modules` copy still cannot be stripped, so published packages
  stay built JS until npm publishing lands — production ships the repo source (symlinked
  workspaces) rather than installed interop tarballs.

## Work items

### nix packages/images (`nix/packages/sai-*.nix`, `nix/images/sai-*.nix`)

They currently use `pkgs.buildNpmPackage` + `pkgs.nodejs_26` and run built
`dist` against published npm deps. Rework them to ship the repo source and run
Node 26:

- `sai-css.nix` — runs `@solid/community-server/bin/server.js` (via
  `makeWrapper ${pkgs.nodejs_26}`). Keep Node 26; the CSS services already run
  under Node 26 in dagger/compose.
- `sai-worker.nix` — runs
  `@elfpavlik/sai-components/dist/workers/main.js`. Keep Node 26 and the worker
  entrypoint; note the worker currently lives in `components` — the
  `extract-temporal-workflows.md` plan may move it.
- `sai-id.nix` — runs `http.ts` (already TS).
- `sai-ui.nix` — builds the Vite UI `dist` (leave as a build unless the UI is
  also moved to Node-native TS loading).
- `nix/images/sai-*.nix` — Node 26 and update `Cmd`s.
- `flake.nix` — image `paths`/`nativeBuildInputs`.

### Services / consumers

- `services/id` — runs `.ts` under Node 26 (it imports the TS-only interop
  packages, resolved via workspace symlinks).
- `ui/authorization` — depends on `@janeirodigital/sai-api-messages` via
  `file:`; Vite handles the `.ts` exports, but verify the `vue-tsc` build and
  the dev server.
- `docs/website` — check nothing imports interop packages.
- `README.md` — update the dev instructions (`npm run build` no longer needed
  for the interop libs; `dagger call test` needs `packages/components/dist`).
- `.dagger` / `docker-compose.yaml` — already switched to Node 26; the Vite
  dev servers (`ui`, `vuejectron`) run on `node:26-alpine`.
- Use Node's `--require` for `tracing/preload.cjs` on every image command line
  (the Bun `--preload` form is gone).

## Gate

G1 + G2 + G3 green:

- `npx vitest run`
- `npm run typecheck`
- `npm run build -w @elfpavlik/sai-components` + `dagger call test`
