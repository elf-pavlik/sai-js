# LWS alignment follow-ups

> **Status:** ⬜ not started — follow-up work after the completed LWS alignment phases.
> **Last verified:** working tree (2026-11-13) — Phase 1 and Phase 2 complete; package suite and full Dagger suite green.
> **Green gate:** `npm run typecheck && npm run check && npx vitest run`; rebuild `@elfpavlik/sai-components` before Dagger; `/test` is user-run.
> **Workstream:** former `lws/` alignment plan (removed; history in git).

Absorbs: former `lws/TODO.md`, `lws/lws-alignment-plan.md`, and
`lws/phase-0-wire-contract.md`. The landed design is the owner-scoped
`/.sai/access-requests/<owner>` and `/.sai/grants/<owner>` services, the frozen
ODRL wire shape, CID discovery, and the removal of the `.lws` access stores.

## Grant view

- [ ] Show delegated grants from other assigner registries, and optionally
      mirrored peer grants, in `/.sai/grants/<owner>`. The current view reads
      only the assigner's `GrantRegistry`; this was deliberately deferred when
      the read-only grant view landed.
- [ ] Decide whether `Inherited` grant targets should copy the parent grant
      target instead of using the child registration. Current grants are
      self-contained and use the child registration; revisit if the profile
      target matcher needs literal parent-target semantics.
- [ ] Remove the temporary policy-level `registeredShapeTree` extension and the
      selected-target `partOf` compatibility field once shape-tree and
      registration lookups resolve from the target alone.

## Needs and grants profile

- [ ] Add optional `storage` to needs requests once the requester knows the
      target storage.
- [ ] Reconsider `requester = dataOwner` for owner-issued grants.
- [ ] Remove `scopeOfGrant` from request/grant envelopes when clients can derive
      the scope from targets.
- [ ] Upstream the bundled LWS context fixes to the LWS context PR:
      `odrl:assignee` IRI coercion, target `value` → `lws:value`, top-level
      `storage`, and top-level `@protected` removal for context composition.
- [ ] If the CSS `.lws` access-document path is ever re-enabled, update CSS
      `AccessPolicy.action` / `ACTION_MODES` to normalize ODRL action IRIs and
      compact terms. It is currently out of the active SAI path.

## Flat storage / identifiers

- [ ] Implement the long-term hierarchical/path identifier strategy. Flat
      storage currently mints members as UUIDs directly under the storage root;
      the old path-based helpers were deliberately removed.
- [ ] Remove or gate the remaining path-based parent fallback.
      `SaiPermissionsEngine.getRegistrationId` prefers the stored `lws:partOf`
      (`getParentFromStore`) but still falls back to
      `SaiAuthorizationManager.getParent`, which uses
      `identifierStrategy.getParentContainer`. Under flat storage that returns
      the pod root, not the real parent.
- [ ] Reduce the per-check SPARQL queries in `SaiPermissionsEngine`
      (`determineTargetType` + parent + grandparent + registration). Combine
      them into one `SELECT ?type ?parent` query and pass the registration id
      through `findRegistrationModes` / `findInheritedModes`.

## Docs / build

- [ ] Update `README.md` fully to the LWS-only mode; it still describes the
      Solid/dual configuration in places.
- [ ] Nix image builds still need the CSS git dependency's `dist/`. The deps
      phase runs `npm ci --ignore-scripts`, which skips the fork's `prepare`;
      use a prebuilt tarball or a separate CSS derivation.
- [ ] Rebuild `examples/vuejectron/dist` so the compose stack serves the UI with
      the `sessionFetch` change.
- [ ] Re-run `npm run codegen:likec4 --workspace docs/website` whenever
      `docs/temporal.c4` changes; the tracked webcomponent is generated.

## Operational notes

- Temporal activity names changed during the LWS work (`storeAccessGrant`,
  `deleteAccessGrants`, `replaceAccessGrantsOnRegistration`). In-flight
  workflows created by older builds will not resolve the new activity names;
  restart/reseed dev stacks after deploying a build with these names.
- The Dagger integration suite is green on the pinned CSS fork (`lws-sai` at
  `99c208447`).
