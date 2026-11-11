# Remaining work

The LWS alignment target and its phased implementation are in
[`lws-alignment-plan.md`](./lws-alignment-plan.md). This file only tracks
remaining flat-storage / infrastructure work that is not part of that plan.

Baseline: the Dagger integration suite is green on the pinned CSS fork
(`lws-sai` at `99c208447`). Rebuild components before a run when
`packages/components/src` changed:

```bash
npm run build --workspace @elfpavlik/sai-components
dagger call test
```

## Flat-storage / identifier work

- [ ] Implement the long-term hierarchical/path identifier strategy. Current
      flat storage mints members as UUIDs directly under the storage root; the
      old path-based helpers/branches were deliberately removed.
- [ ] Remove or gate the remaining path-based parent fallback.
      `SaiPermissionsEngine.getRegistrationId` already prefers the stored
      `lws:partOf` (`getParentFromStore`), but still falls back to
      `SaiAuthorizationManager.getParent`, which uses
      `identifierStrategy.getParentContainer`. Under flat storage that fallback
      returns the pod root, not the real parent. Either remove it for flat
      storage or restrict it to genuinely hierarchical data pods.
- [ ] Reduce the per-check SPARQL queries in `SaiPermissionsEngine`
      (`determineTargetType` + parent + grandparent + registration). Combine
      them into one `SELECT ?type ?parent` query and pass the registration id
      through `findRegistrationModes` / `findInheritedModes`.

## Docs / build

- [ ] Regenerate `docs/website/public/likec4-webcomponent.js` if the site should
      show the flat IRIs; it is generated and was skipped by the IRI rewrite.
- [ ] Update `README.md` to the LWS-only mode; it still describes the
      Solid/dual configuration.
- [ ] Nix image builds still need the CSS git dependency's `dist/` (the deps
      phase runs `npm ci --ignore-scripts`, which skips the fork's `prepare`).
      Use a prebuilt tarball or a separate CSS derivation.
- [ ] Rebuild `examples/vuejectron/dist` so the compose stack serves the UI with
      the `sessionFetch` change.
