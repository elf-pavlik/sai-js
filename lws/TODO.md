# Remaining work

Phase 1 of the [LWS alignment plan](./lws-alignment-plan.md) is **complete
(interim shape)**: the access-grant model, seeds/fixtures, and terminology were
migrated, and the full Dagger integration suite is green. Phase 2 Step 0 is a
Phase 1 redo of the data model against the frozen ODRL contract.

Start a new phase by reading the plan first. Agreed wire payloads are recorded
in [`phase-0-wire-contract.md`](./phase-0-wire-contract.md).

- [x] Phase 0 — freeze the wire contract (`lws-alignment-plan.md` §2.2, §8)
  - [x] Freeze the SAI profile URI, context document, and term list.
  - [x] Freeze the needs, delegation, `AccessGrant`, revocation, and
        admin-grant payloads ([wire contract](./phase-0-wire-contract.md)).
  - [x] Add mapping tables and divergences (wire contract).
  - [x] Bundle the LWS context and load it locally as RDF.
- [ ] Phase 2 — protocol sequencing (`lws-alignment-plan.md` §8)
  - [x] Step 0: **Phase 1 redo** — migrate access grants, admin grants, request
        builders, and handlers to the ODRL shape; land the SAI + local ODRL
        contexts and expansion/framing tests (green-to-green, current protocol).
        Package suite and full Dagger integration suite are green.
  - [x] Step 1: owner-scoped `/.sai/access-requests/<owner>` (needs only).
        POST accepts the frozen ODRL needs payload, returns `202` with no
        `Location`/body, and validates the URL owner against the payload's
        `assigner`; the old request-shape fallback is retained temporarily.
        GET/HEAD are an owner-only facade over the owner's
        `AccessRequestRegistry` container/member (registry-relative member
        paths). Delegation and revocation remain on the legacy `.sai/grants`
        route for Steps 2–3. Package suite and full Dagger integration suite
        are green.
  - [x] Step 2: move delegation issuance to the access request endpoint.
        The frozen top-level delegation array (and the temporary legacy
        `grants` fallback) now POST to
        `/.sai/access-requests/<owner>`; the URL owner must match the payload
        `assigner`. `requestDelegations` targets the new endpoint directly
        while discovery/WebID still advertise the legacy route until
        Step 6. The old `.sai/grants` POST now rejects delegation;
        chain validation and the synchronous issued-grants response are
        unchanged. Package suite and full Dagger integration suite are green.
  - [x] Step 3: move revocation to the access request endpoint.
        `AccessRequest` + `AccessRevocationRequest` payloads now POST to
        `/.sai/access-requests/<owner>`; authority, all-or-nothing validation,
        C1 closure, automatic revocation, and owner-workflow deletes are
        unchanged. `requestRevocations` targets the new endpoint directly.
        The legacy `.sai/grants` POST route was removed in Step 4. Package
        suite and full Dagger integration suite are green.
  - [x] Step 4: `/.sai/grants/<owner>` becomes the read-only grant view.
        Served by `AccessGrantHandler` over the assigner's grant registry.
        UAS clients see the registry grants where the authenticated user is
        the assignee or requester; other clients see only grants whose
        assignee is that client and whose assigner is the authenticated user.
        Mirrored peer grants are excluded, and the old `.sai/grants` POST
        route is gone. TODO: showing delegated grants from other assigner
        registries (and mirrored peer grants) is intentionally deferred.
        Package suite and full Dagger integration suite are green.
  - [x] Step 5: disable `.lws` access stores/readers; replace the CSS describer.
        SAI data/registry servers now use `sai:config/ldp/handler/lws.json`,
        which drops the `.lws` access initializer, `AccessGrantIndex/Reader`,
        and `AccessDocumentOperationHandler` while keeping LWS storage
        description, token exchange, containment, and notifications.
        `SaiAccessServiceDescriber` advertises the owner-scoped access request
        and grant services in the storage description; `.lws/grants/` and
        `.lws/requests/` are no longer created or read. Package suite and full
        Dagger integration suite are green.
  - [ ] Step 6: CID/discovery (`application/cid`, access request/grant services).
  - [ ] Step 7: cleanup (`issuanceUrl`, old guards/routes/types, docs).

## Phase 1 follow-ups

- [ ] Upstream the bundled LWS context fixes to the LWS context PR:
      `odrl:assignee` IRI coercion, target `value` → `lws:value`, top-level
      `storage`, and the top-level `@protected` removal for context composition.
- [ ] Decide whether `Inherited` grant targets should copy the parent grant
      target instead of using the child registration (current self-contained
      choice; see plan §2.4 implementation note).
- [x] Document the naming exception: `interop:hasDataGrant` remains the
      registration → grant **link predicate**; only the grant resource type
      `interop:DataGrant` is gone.
- Note: Temporal activity names changed in Phase 1 (`storeAccessGrant`,
  `deleteAccessGrants`, `replaceAccessGrantsOnRegistration`); old in-flight
  workflows need a restart/reseed.

## Working commands

The Dagger integration suite is green on the pinned CSS fork (`lws-sai` at
`99c208447`). Rebuild components before a run when
`packages/components/src` changed:

```bash
npm run build --workspace @elfpavlik/sai-components
dagger call test
```

Package unit tests:

```bash
npx vitest run
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
