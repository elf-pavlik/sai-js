# npm publishing (`@hackers4peace`)

> **Status:** 📋 not started — future goal. Replaces the dropped JSR plan;
> extracted from `esm-jsr-no-build.md` (Phase 6 + §6).

## Goal

Publish the packages to npm under the **`@hackers4peace`** org. All packages
move to that scope — `@janeirodigital/interop-utils`, `-data-model`,
`-application`, `-authorization-agent`, `-test-utils`, `sai-api-messages`, and
`@elfpavlik/sai-components` → `@hackers4peace/*`. The old `@janeirodigital` and
`@elfpavlik` scopes are retired.

## Steps

1. Create the `@hackers4peace` npm org + publishing auth (token or OIDC).
2. Rename packages and every cross-package dependency specifier/import.
3. Decide the published artifact: the interop libs are TS-source-only and Node
   cannot strip `.ts` inside `node_modules`, so a publish-time build is needed
   for Node consumers; `components` already builds (`tsc` +
   `componentsjs-generator`).
4. Add a release workflow with `package.json` as the version source of truth.
5. Dry-run (`npm pack`) + a Node consumer smoke test.

## Gate

A dry-run publish produces the expected package set, and a Node consumer can
install and import each package.
