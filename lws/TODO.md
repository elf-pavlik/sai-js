# Flat LWS storage — status and remaining work

Single source of truth. The data and registry services run **LWS-only flat
storage**; the SAI access layer uses **`lws:contains`** for containment and
**`lws:partOf`** for the parent; the fixture and account bootstrap template
carry both; storage discovery (`rel="storage"` → `lws:StorageRoot`) is
implemented. The client auth migration (§1) and the Dagger integration suite
(§7) are **done and green**.

## Current state (check before starting)

- **`dagger call test` is green** — all 22 files, CI mode, on the CSS fork
  branch `lws-sai` at `9799e86d2` (installed from `package-lock.json` by
  `devbox run fork-css`). Package tests, typecheck, lint and the components
  build pass.
- The data and registry services run **LWS-only flat storage**; the SAI access
  layer uses `lws:contains` for containment and `lws:partOf` for the parent;
  the fixture and the account bootstrap template carry both. Storage discovery
  (`rel="storage"` → `lws:StorageRoot`) is implemented, as is the per-storage
  LWS token exchange for SAI sessions and the UI (`/.sai/lws-token`).
- Rebuild before a dagger run when `packages/components/src` changed:
  `npm run build --workspace @elfpavlik/sai-components` — the suite mounts the
  working tree plus the built `dist`.
- Test data: `environments/data/registry.trig` (split per pod by the harness)
  and `kv.json` (accounts, channels, endpoint records); the harness re-seeds
  Postgres KV + Fuseki before every test. `environments/dev/map.json` holds the
  dev URL mapping.
- Local CSS iteration without pushing: see §8 (`--css` constructor argument, or
  copy the fork build into `node_modules/@solid/community-server`).
- Remaining work is the tail of §2/§5/§6/§7 plus §8 images/docs — the flat-LWS
  migration itself (client auth, containment, representations, storage
  discovery, authorization, tests) is complete.

## 1. Client auth migration — done

Goal: the SAI UAS/UI obtain an **LWS access token** for each data/registry
storage and use it for LDP requests. The auth service's `.sai` RPC stays on
Solid-OIDC DPoP (it is the IdP/UAS).

- [x] Discover the LWS authorization server for a storage:
      `resource_metadata` (RFC 9728) → `authorization_servers`, fallback
      `as_uri`, fallback probe of the storage origin's
      `/.well-known/lws-configuration` (covers servers that are their own AS,
      e.g. the registry). Implemented in `packages/utils/src/lws-auth.ts`.
- [x] Exchange the UAS ID token at the AS token endpoint:
      `grant_type=urn:ietf:params:oauth:grant-type:token-exchange`,
      `subject_token_type=…:id_token`, `subject_token=<self-issued ID token>`,
      `resource=<storage URI>`, plus a `DPoP` proof signed with the key in the
      subject token's `cnf.jkt` (required by the fork HEAD).
- [x] Cache the access token per storage (~300 s lifetime, 30 s renewal
      margin, in-flight dedupe).
- [x] Use the LWS token for data/registry requests (`Authorization: Bearer`);
      keep `.sai` on DPoP (`SessionManager` routes by auth-server origin).
- [x] Files touched: `SessionManager`, `utils/lws-auth.ts`,
      `utils/jsonld.ts`, `authorization-agent`, `examples/vuejectron`.
- [x] The LWS token's `sub`/`client_id` map to the SAI `Credentials`:
      `agent.webId` = WebID, `client.clientId` = the owner's Authorization
      Agent (because the self-issued token now carries `azp`), which is what
      `SaiPermissionsEngine`/`AdminPermissionReader` expect for the owner UAS.
- [x] UI path: `/.sai/lws-token?resource=<storage>` on the auth server mints
      the token for the caller's DPoP session; the UI wraps its inrupt fetch
      with `createLwsFetch({ tokenSource })`.
- [x] Temporary dual-auth fallback not needed.

## 2. Registry creation: current choice vs fully flat

The registry **config** is flat (`HonorUuidSlugDataAccessorBasedStore` over the
routed SPARQL accessor) and the access layer uses `lws:contains`. The registry
**set** and dedicated registries are bootstrap structure with path-based IRIs;
their **members** are still created by `iriForContained` + PUT (path-based
member IRIs) — this is the “reuse the old code” choice. The flat store writes
`lws:contains` to the path parent, so listings work; new PUT members do not get
`lws:partOf` (the path fallback is used for up/deletion).

- [ ] Decide: keep the path-based registry member IRIs (current) or switch to
      flat UUIDs. If fully flat, replace the registry
      `iriForContained` + `putJsonLd` pairs with the `postForIri` / POST+Slug
      helper used for data instances
      (`packages/utils/src/container.ts`).
- [ ] `createDataRegistration`
      (`packages/authorization-agent/src/data-registration.ts`) is still
      PUT/description-PATCH based and has no callers. Flat path: POST +
      `Link: <https://www.w3.org/ns/lws#Container>; rel="type"` to the pod
      root, then write `registeredShapeTree` to `meta:<registration>` (direct
      SPARQL update), or add a CSS extension for container metadata.
- [x] `createContainer` for social-agent/application registrations verified
      against the flat store: PUT the empty container, discover the `.meta`
      description (registry config has the ACR/`.meta` auxiliary), PATCH the
      description; `.acr` writes now convert to quads (see §3). Live test:
      `AgentRegistry.addSocialAgentRegistration`.
- [ ] Data instances created by POST are **empty** resources (the body is not
      the data representation); callers must PUT the data afterwards. This is
      what `Application.iriForNew` + the LDO write do; document it in
      `postForIri`.

## 3. LWS-only representations and writes

- [x] Data/registry use `css:config/util/representation-conversion/lws.json`:
      `application/ld+json` returns the LWS JSON document for containers.
- [x] `fetchJsonLd` sends
      `Accept: application/ld+json; profile="https://www.w3.org/ns/lws/v1"`
      and retries plain `application/ld+json` on 406/415.
- [x] Containers: the LWS JSON page listing loses the container's own RDF
      (e.g. `interop:hasDataRegistry` of a registry set), so `fetchJsonLd`
      detects it and re-fetches the container as `text/turtle` (not an LWS
      JSON output type), parsed to expanded JSON-LD. Plain turtle on the fork
      HEAD returns the stored RDF; `text/turtle; profile=lws` returns the LWS
      page RDF — do not use the profile for this.
- [x] `putJsonLd` verified: expanded JSON-LD with
      `Content-Type: application/ld+json` is accepted by the flat data store;
      no LWS profile needed on writes.
- [x] The flat **registry** store needed
      `ResourceStore_Converting` `inPreferences: internal/quads` in
      `config/storage/flat-sparql.json` (mirrors CSS `sparql-flat.json`);
      without it RDF writes 415 (“Only Quad data is supported”).
- [ ] Any direct `fetch(..., { headers: { Accept: 'application/ld+json' } })`
      outside `fetchJsonLd` must use the profile or `application/lws+json`
      (audit `fetchPeerResource`, `Notifications`, examples).
- [x] `fetchPeerResource` (org-context proxy) reads through `fetchJsonLd`
      instead of pinning `Accept: application/ld+json`: a peer registration
      container answers the LWS JSON page listing, which `fetchJsonLd`
      re-fetches as RDF, so the proxy returns frameable expanded JSON-LD.
      `ProxyAdminHandler` maps `HttpStatusError` (404 → NotFound, else 403) and
      drops the `isJsonLdContentType` passthrough gate.
- [ ] Do not switch RDF documents to `application/lws+json`; the data model
      expects JSON-LD (the profile is the supported path).

## 4. Containment and data model

- [x] `listContained` is `lws:contains` only — no `ldp:contains` fallback —
      for data and registry pods.
- [x] `listRegistrationsByShapeTrees` is `lws:contains` only.
- [x] `graphDoc` no longer rewrites `lws:contains`; `dataModelContext` has
      `lwsContains` and `lwsPartOf`; `DataRegistration` merges `lws:contains`
      into `contains` and exposes `partOf`.
- [x] Registry fixture and `registrySetTemplate` carry
      `lws:contains` / `lws:partOf`.
- [x] Flat parent resolution for data instances:
      `getContainingContainer` (SPARQL `lws:partOf`), `loadDataInstance`
      accepts the registration IRI, `AuthorizationAgent` resolves it from the
      instance's pod, components `DataRegistry`/`ShareResource` pass it.
- [x] `findDataRegistration` queries the **data pod's** dataset
      (`resolveEndpoint(dataRegistryIri)`), not the session's registry-pod
      dataset.
- [ ] `DataInstanceData` still has no `partOf` (the instance document does not
      carry it — it is in the pod's `meta:` graph); callers use SPARQL.
- [x] `data/shapetrees` LWS metadata added: `meta:` root typed
      `interop:DataRegistry`/`ldp:Resource`/`space:Storage` with `lws:contains
      trees/`, `trees/` as an `ldp:Container` registration (`lws:contains` the
      7 shape trees, `lws:partOf` the root) and `lws:partOf` on each tree. Its
      listings work and the pod is a valid LWS storage for the token exchange
      (`policy-engine` needs both). `test-client` still keeps hierarchical IRIs
      with LWS metadata.

## 5. Storage discovery

- [x] `rel="https://www.w3.org/ns/lws#storage"` → `application/lws+cid`
      storage description → `StorageRoot` service
      (`discoverLwsStorage`, `fetchLwsStorageDescription`, `lwsStorageRoot`).
- [x] `storageIri` prefers LWS and keeps a Solid fallback for the auth/registry
      servers that do not advertise it.
- [x] Data/registry LWS configs advertise `rel="storage"` and serve the
      storage description (verified with curl).
- [ ] Remove the Solid fallback once the auth service also advertises the LWS
      storage link (or keep it for auth-only resources).
- [ ] Use `lwsStorageRoot` wherever the app needs a storage root (search
      `storageIri` callers); the registry/data labels now resolve through the
      LWS description.

## 6. Authorization / permissions

- [x] `SaiPermissionsEngine.determineTargetType` uses RDF types +
      `lws:partOf`, not path depth; unknown/auxiliary resources return
      `Resource` (deny) instead of throwing.
- [x] `SelectedFromRegistry` / `Inherited` use the `lws:partOf` registration.
- [x] LWS credentials mapping verified live: agent/client/issuer reach the
      policy engine as strings; the owner UAS gets the owner's admin
      permissions (`AdminPermissionReader`).
- [x] `AdminPermissionReader` owner map now includes `Append` (LDP POST on a
      container asks for Append, which is separate from Create).
- [ ] `.lws/grants/` / `.lws/requests/`: the LWS handler's `lws-access.json`
      union with the SAI policy engine; verify non-admin access-request
      members and grant container reads.
- [ ] `findAgentsWithAccess`/`matchesScope` throw on `AllFromRole`
      authorizations (the live test avoided the call). Resolve role
      memberships (or skip unsupported scopes) for “who has access”.
- [ ] Org-context writes: `buildShareDataAuthorizations` calls
      `session.loadDataInstance(resource)`/`findDataRegistration` with the
      signed-in user's session, which does not know the org's data-pod
      endpoints (isolation). Pass the context's `endpoints` (or a transport)
      through the org-context share path.
- [x] UI notification stream: `NotificationManager` uses the LWS session
      fetch, `createLwsFetch` sends a same-origin storage token for
      `/.notifications/…` service paths, the fork's `servicePaths` accepts it
      and the handlers authorize the decoded topic (the reciprocal-webhook
      streaming test is the live proof). The UI bundle still needs a rebuild
      (§8) for the compose stack.
- [ ] Reduce the per-check SPARQL queries (`determineTargetType` + parent +
      grandparent + registration). Combine into one `SELECT ?type ?parent`
      and pass the registration ID through `findRegistrationModes` /
      `findInheritedModes`.
- [ ] `SaiAuthorizationManager.getParent` remains path-based; only the engine
      fallback uses it.
- [ ] Labels in `Authorization.ts` still split `hasDataRegistration` by `/`;
      use the shape-tree label or `hasStorage`.

## 7. Tests / docs

- [x] Package tests, typecheck, lint, components build pass.
- [x] Registry fixture/test mocks updated to `lws:contains`; data-registration
      framing expects `partOf`.
- [x] New unit tests: `packages/utils/test/lws-auth.test.ts` (challenge
      parsing, AS discovery, exchange + DPoP proof, cache/retry/tokenSource).
- [x] New live checks: `packages/components/test/lws-live.test.ts` (skipped
      unless `LWS_LIVE`; run inside the `worker` container).
- [x] Test helpers migrated to flat containment: `containedIris` /
      `containedCount` in `test/util.ts` (the `ldp:contains` ∪ `lws:contains`
      union over the session's LWS fetch). Replaced the raw `LDP.contains`
      reads in `authorization-revocation` (`countContained`),
      `delegation-endpoint` (`countGrants` + the direct DELETE now carries the
      storage's LWS token so the read-only ACR answers 403, not 401),
      `access-request` (`storedAccessRequests`), `admin-events` /
      `personal-admin` (`adminGrantIris`) and `authorization` (the two
      AccessRequestRegistry reads). `services.test.ts` now expects the data
      pod's public `application/lws+cid` storage description (200).
      Production code unchanged — no components rebuild needed.
- [x] Auxiliary resources are **not** container members (Solid §4.3; the
      container representation already filters them out of `ldp:contains`).
      Found while rerunning `delegation-endpoint`: the flat store's
      `addContainedResource` had no auxiliary guard, so creating a grant **and
      its `.acr`** wrote two `lws:contains` triples — every runtime-created
      resource over-counted by one in container listings (`countGrants` saw 14
      where 12 grants existed; 18 where 14). Fixed in the CSS fork's
      `DataAccessorBasedStore`: skip auxiliary identifiers in
      `addContainedResource` / `removeContainedResource`, and skip stored
      auxiliary children in `getContainerChildren` (covers containers written
      before the guard, and `hasProperChildren`). Fork spec added to
      `test/integration/LinkedWebStorageFlat.test.ts`; `npx jest
      test/integration/LinkedWebStorageFlat.test.ts` and
      `npx jest test/unit/storage` (742) pass.
- [x] Auxiliary members filtered on the **client** side too — this was not a
      test artifact: `findAdminGrants` (the RemoveAdmin activity) loaded the
      grants' `.acr` children as grants and died with
      `Node …/grant/<id>.acr not found in framed output`, which failed the
      whole admin workflow. `containedIrisJsonLd` (`packages/utils`) and
      `listContained` (`packages/authorization-agent`) now drop
      `.acr`/`.acl`/`.meta` members (`isAuxiliaryResource` in
      `packages/utils/src/container.ts`), so the client is immune to the
      installed `01ad3376` while the fork fix removes the cause. Unit tests:
      `containedIrisJsonLd` union+filter, `isAuxiliaryResource`,
      `listContained` filter; `test/util.ts`'s `containedIris` delegates to the
      production helper.
- [x] Auxiliary **discovery** on a storage root: a registry set (and a pod
      root) *is* a storage root, so a wildcard or absent `Accept` HEAD returns
      the public LWS storage description (`application/lws+cid`) — its links
      carry only `lws#storage` + the notification channel, **no `rel="acl"`**.
      `syncAdminAcr` therefore died with `no acl link on registry set:
      https://registry/kim/`, which failed the whole admin workflow (both
      AddAdmin and RemoveAdmin — the child workflow run is what kept the
      activity pending). `discoverAccessResource` / `discoverDescriptionResource`
      now send `AUXILIARY_DISCOVERY_ACCEPT`
      (`text/turtle, application/ld+json;q=0.9, */*;q=0.1`) so the *resource*
      representation is served (the wildcard keeps non-RDF resources
      discoverable); `syncAdminAcr` and the `fetchRegistrySetAcr` test helpers
      use `discoverAccessResource`. Unit tests assert the header.
- [x] `SaiPermissionsEngine` Registration branch now unions the registration's
      **Inherited** grant modes: creating a new member (POST to the flat
      registration container) happens before the parent instance links it, so
      the `findParentResource` gate of `findInheritedModes` can not apply — the
      grant's access modes on the registration are what authorize the append.
      The parent gate still applies to writing the new member's content (the
      `Resource` branch), which `policy-engine.test.ts` now asserts
      (POST → PUT denied → link parent → PUT 204).
- [x] Run the dagger integration suite — **green**, all 22 files
      (`dagger call test`, CI mode, fork CSS `9799e86d2`). The suite mounts the
      working tree and the **built** `packages/components/dist`, so rebuild
      first when components sources changed:
      `npm run build --workspace @elfpavlik/sai-components`. Narrow runs with
      `--testFile="agents.test.ts share.test.ts"` / `--only="<test name>"`.

### Open: registry storage reads 401 (after fork-css + notification override)

First run after `devbox run fork-css` (lock → `9799e86d2`) plus importing
`sai:config/overrides/lws-notification-service-paths.json`: `invitation` and
`reciprocal-webhook` answer **500** on the create RPC, and `roles` fails in
`waitForQuiescence` → `getSession` → bootstrap fetching
`https://registry/<pod>/` with **401**. `createLwsFetch` sends storage requests
unauthenticated first and only mints a token when the `401` carries a parseable
challenge, so a surfaced `401` means either the challenge is missing or the
minted token was rejected.

Probe 1 (done): for `dan` everything works — anonymous 401 carries
`Bearer resource_metadata=… as_uri=… realm=…`, `https://registry/.well-known/
lws-configuration` is 200, `buildLwsFetch` gets a token and returns 200, and
`getSession('https://id/dan')` bootstraps. So the notification override does
**not** break `LwsAccessTokenExtractor`, and the LWS AS metadata is fine.

Probe 2 (done): all five session bootstraps succeed (`registry/alice`,
`/kim`, `/bob`, `/dan`, `/yoyo`) and `CreateInvitation` as dan returns
**200 Success** with the pre-minted invitation id. So the batch's 500s/401s
were **transient**, not code: the `--debug` log of that run shows the stack
still coming up (Fuseki/Temporal/Garage `port not ready`, Garage handshake
aborted, Temporal `duplicate key value violates unique constraint
"namespaces_pkey"`), which is the classic cold-start race. Re-run the three
files on a warm run; if it recurs, make `testBase()` wait for the auth/registry/
data health endpoints, not just Temporal.

### Resolved: `.sai/sparql-admin` DPoP verification (org-context)

Symptoms (local fork build): every `.sai/sparql-admin` `QUERY` answers `403
this endpoint requires credentials`, for both a `SessionManager` session and a
plain `buildOidcSession(...).authFetch`. `UnionCredentialsExtractor` has
`ignoreErrors` on, so a failed DPoP verification degrades to
`PublicCredentialsExtractor` (no agent) and `requireOrgAdmin` turns it into that
403 — the extractor's own `BadRequestHttpError` never reaches the client. Both
`htm`/`htu` look right client-side (`htm=QUERY`, `htu=<origin><pathname>`), and
`@solid/access-token-verifier` 2.1.2 (root `overrides` fork) whitelists `QUERY`,
while DPoP-authenticated `.sai/grants` POSTs pass. Next step: read the auth
container's warning (`DPoPWebIdExtractor` logs the verification error) with
`dagger call --debug test --testFile="zz-diagnose.test.ts" 2>&1 | grep -i dpop`.

### Dagger suite status — all green

`dagger call test` (CI mode, fork CSS `9799e86d2`) passes **all 22 files**.
Keep it as the regression baseline; narrow runs are for bisecting only:

```bash
dagger call test                      # full suite
dagger call test --testFile="agents.test.ts share.test.ts"
dagger call test --testFile="authorization.test.ts" --only="<test name>"
```

Rebuild before a run when `packages/components/src` changed:
`npm run build --workspace @elfpavlik/sai-components`.

What made the flat-LWS suite green (nothing here is outstanding):

1. **Client auth (§1)** — LWS token exchange per storage (DPoP-bound subject
   token), token cache, `.sai` stays on DPoP.
2. **Containment (§4)** — `lws:contains` / `lws:partOf` everywhere; `listContained`
   and `containedIrisJsonLd` read the flat plane.
3. **Auxiliary members are not container members** — the CSS ≤ `01ad3376` flat
   store recorded `lws:contains` for `.acr`/`.acl`/`.meta`, which made
   `findAdminGrants` load a grant's ACR as a grant. Filtered in
   `containedIrisJsonLd` + `listContained` (`isAuxiliaryResource`), and fixed
   at the source in the fork (`DataAccessorBasedStore`).
4. **Storage-root negotiation** — a registry set (and a pod root) *is* a
   storage root: a wildcard/absent-`Accept` HEAD returns the LWS storage
   description, whose links carry **no** `rel="acl"`. `syncAdminAcr` therefore
   never completed → every admin activity stayed pending. Fixed with
   `AUXILIARY_DISCOVERY_ACCEPT` in `discoverAccessResource` /
   `discoverDescriptionResource` (and used by `syncAdminAcr` + the
   `fetchRegistrySetAcr` helpers).
5. **Peer data (§3 proxy)** — `fetchPeerResource` reads through
   `fetchJsonLd` (LWS page listing → RDF fallback); `peerRegistrationOfInstance`
   resolves a peer instance's registration from the context's grants through
   `/proxy-admin` (the org can not read the peer's `lws:partOf`).
6. **Flat creation semantics** — `SaiPermissionsEngine`'s `Registration` branch
   now honours the registration's **Inherited** grant for appends (a new member
   is appended before the parent links it); the parent gate still applies to
   writing its content. `policy-engine` exercises POST → PUT(403) → link →
   PUT(204).
7. **Test harness** — `containedIris`/`containedCount` helpers on the session's
   LWS fetch, `buildLwsFetch(webid, clientId?)` for the agent/client matrix,
   `204` instead of `205`, storage requests through sessions (never `.sai` DPoP).
8. **Notification service (§8)** — the fork HEAD's `servicePaths` +
   `sai:config/overrides/lws-notification-service-paths.json` imported in
   `data.json`/`registry.json`; notification streams use the session's LWS
   fetch (the channel's storage token), not `.sai` DPoP.
9. **Fixture** — `data/shapetrees` now has LWS storage metadata (`meta:` root +
   `trees/` container with `lws:contains`, `lws:partOf` on the shape trees), so
   its listings work and the pod is a valid LWS storage for the token exchange.

Per-file notes worth keeping (regression map):

| test file | what it pins down |
|---|---|
| `agents` / `agent-discovery` | `.sai/agents` HEAD, registry/redirect links, client-id doc over `lws:contains` listings |
| `authorizations` | `ListAuthorizations` RPC over the SPARQL plane |
| `check-equivalence` | grant regeneration keeps IRIs (activity listing + registry writes) |
| `discovery` | discovery helpers against live servers; needs the representation-cache bypass (`no-cache.json`) |
| `key-scoping` | per-pod Garage buckets/keys |
| `reconciliation` | sweep (Temporal); peer-fetch token selection per storage + cache bypass + DELETE 204 |
| `services` | data pod's public `application/lws+cid` storage description (200) |
| `access-request` | need-based flow (sent + both receive legs) via `containedIris` |
| `authorization-revocation` | revocation RPC + `containedCount` on the flat grant registry |
| `delegation-endpoint` | issuance/revocation; direct grant DELETE carries the LWS token (ACR 403); aux-member filter keeps counts exact |
| `admin-events` / `personal-admin` | admin marker + ACR rewrite (`syncAdminAcr` storage-root ACL discovery) |
| `org-context` | registry set, roles, admin gating, peer proxy (`GetResource` via `peerRegistrationOfInstance`) |
| `policy-engine` | engine matrix over HTTP: `buildLwsFetch` client/agent pairs, flat create flow, 204s |
| `reciprocal-webhook` | webhook delivery + `delegatedGrantsUpdated` events; stream opened with the LWS fetch |
| `invitation` / `federation-mirror` / `share` / `roles` / `authorization` | notification-dependent chains (`awaitGrantCompletion` with `session.fetch`) |

- [ ] `docs/website/public/likec4-webcomponent.js` is generated and was skipped
      by the IRI rewrite; regenerate the docs bundle if the site should show
      the flat IRIs.
- [ ] Update `README.md` / `first-look.md` to the LWS-only mode (the current
      notes still describe the Solid/dual config).
- [ ] OpenWiki is generated; do not hand-edit.

## 8. Dev / CI / images

- [x] **CSS build used by tests/CI**: fork branch `lws-sai` (`9799e86d2`,
  includes the auxiliary-containment guard and `LwsAccessTokenExtractor`
  `servicePaths`), installed from `package-lock.json` by
  `devbox run fork-css`. npm applies this repo's `overrides` at install time,
  so `@solid/access-token-verifier` is the `QUERY`-capable 2.1.2 fork and the
  tree is consistent. `dagger call test` is green on it.
- [x] `sai:config/overrides/lws-notification-service-paths.json` imported in
  `data.json`/`registry.json` (sets `servicePaths: [ ".notifications/" ]`).
  The worker's webhook `POST /.notifications/WebhookChannel2023/` and the
  streaming channel now take a storage token; notification streams must be
  opened with the **session's LWS fetch**, not `.sai` DPoP.
- [ ] **Local fork iteration** (optional): `devbox run local-css` leaves
  `node_modules/@solid/community-server` as an npm symlink to
  `$NPM_CONFIG_PREFIX/lib/node_modules/…` → `../CommunitySolidServer`, i.e.
  **outside** the repo. Dagger only ships `source`, so that link dangles in the
  containers. Two workarounds, both verified:
  - `dagger call --css=../CommunitySolidServer test …` — `--css` is a
    **constructor argument**, so it goes *before* the function name. The mount
    lands at the `npm link` target inside the container (the link then follows
    it) and shadows `/sai/node_modules/@solid/community-server`.
  - copy the fork into `node_modules/@solid/community-server` (`cp -a`, keep
    its `node_modules`, then `rm -rf
    node_modules/@solid/community-server/node_modules/@solid/access-token-verifier`
    — the nested stock 2.1.1 otherwise shadows the root override and every
    `.sai/sparql-admin` `QUERY` fails with `403 this endpoint requires
    credentials`; dropping the whole nested tree instead breaks boot with
    `Cannot find module 'cluster-key-slot'`).
  Pushing the fork and running `devbox run fork-css` remains the simplest path.
- [ ] `services/css` still pins `8.0.0-alpha.2`; not a workspace, not used by
  the stack. Update separately if used standalone.
- [ ] Nix image builds still need the CSS git dependency's `dist/` (the deps
  phase runs `npm ci --ignore-scripts`, which skips the fork's `prepare`).
  Use a prebuilt tarball or a separate CSS derivation.
- [ ] The UI is served from a prebuilt `examples/vuejectron/dist`; rebuild it
  for the `sessionFetch` change to take effect in the compose stack.

## 9. Vocabulary / data model

- [x] `LWS` vocabulary (`contains`, `partOf`, `storage`, `Container`,
      `DataResource`, `StorageResource`); `LDP.Container` / `BasicContainer`.
- [x] `lwsContains` / `lwsPartOf` terms in `dataModelContext`.
- [x] `dataRegistryIri` uses `hasStorage`.
- [ ] Legacy grants without `hasStorage` are unsupported; the fixture has it.

## Useful commands

```bash
# Host-side latest local CSS
cd ~/code/solid/sai/sai-js
devbox run local-css
npm run build --workspace @elfpavlik/sai-components
npm run typecheck
npm test --workspace @janeirodigital/interop-utils
npm test --workspace @janeirodigital/interop-data-model
npm test --workspace @janeirodigital/interop-authorization-agent
npm test --workspace @elfpavlik/sai-components

# Dagger against the LOCAL CSS fork (no push needed)
cd ../CommunitySolidServer && npm run build && cd -
rm -rf node_modules/@solid/community-server
cp -a ../CommunitySolidServer node_modules/@solid/community-server   # real dir inside the mount
dagger call test --testFile="policy-engine.test.ts org-context.test.ts"

# equivalent, without touching node_modules: the --css constructor argument
# (goes BEFORE the function name; nested mounts are verified to work)
dagger call --css=../CommunitySolidServer test

# Stack / CI mode (git CSS)
devbox run fork-css
devbox run up
devbox run seed

# Live LWS checks (inside the compose network; skipped otherwise)
docker compose exec -e LWS_LIVE=1 worker npx vitest run test/lws-live.test.ts

# Storage descriptions (public)
CAROOT="$(mkcert -CAROOT)"
curl -sS --resolve bob.data.docker:443:127.0.0.1 --cacert "$CAROOT/rootCA.pem" \
  -H 'Accept: application/lws+cid' https://bob.data.docker/
curl -sS --resolve reg.docker:443:127.0.0.1 --cacert "$CAROOT/rootCA.pem" \
  -H 'Accept: application/lws+cid' https://reg.docker/dan/

# LWS authorization server metadata (server base URL, not the pod host)
curl -sS --resolve data.docker:443:127.0.0.1 --cacert "$CAROOT/rootCA.pem" \
  https://data.docker/.well-known/lws-configuration
curl -sS --resolve reg.docker:443:127.0.0.1 --cacert "$CAROOT/rootCA.pem" \
  https://reg.docker/.well-known/lws-configuration

# Fuseki flat containment check
curl -s -u admin:sai -H 'Accept: application/sparql-results+json' \
  --data-urlencode 'query=SELECT ?child WHERE { GRAPH ?g { <https://reg.docker/dan/social-agent/> <https://www.w3.org/ns/lws#contains> ?child } }' \
  http://localhost:3030/reg-dan/sparql
```

## Gotchas

- LWS authorization server metadata lives on the **server base URL**
  (`https://data.docker/.well-known/lws-configuration`), not on the pod host
  (`https://bob.data.docker/…` is a 401). Use the `401` challenge
  (`resource_metadata` / `as_uri`) to find it; the origin probe only works
  when the storage origin is the base URL (registry).
- The running git CSS (`01ad3376`) only sends `as_uri`; the fork HEAD sends
  `resource_metadata` too. `parseLwsChallenge` handles both.
- A sender-constrained subject token (`cnf.jkt`) needs a `DPoP` proof at the
  token endpoint on the fork HEAD; `01ad3376` ignores it.
- `postForIri` must send a `Content-Type`; CSS rejects POST without one. The
  created resource is empty — PUT the representation afterwards.
- The flat registry store writes to the SPARQL accessor, which accepts only
  `internal/quads`; `flat-sparql.json` sets the converting store's
  `inPreferences`. The data service converts in `HybridDataAccessor` instead.
- `putJsonLd` with `application/ld+json` works for RDF writes; containers are
  the only LWS-JSON response shape (and `fetchJsonLd` falls back to turtle).
- Auxiliary resources (`.acr`/`.acl`/`.meta`) are **not** container members. On
  the installed CSS `01ad3376` the flat store still records `lws:contains` for
  an auxiliary at creation time, so every runtime-created resource (grant +
  `.acr`, access request + `.acr`, …) adds two entries to its container
  listing. Do not "fix" a count by doubling expectations — either filter
  auxiliary members (`test/util.ts` does) or run the fork build with the
  `addContainedResource` auxiliary guard.
- Deleting a subject deletes its auxiliaries through
  `safelyDeleteAuxiliaryResources`, not through `deleteResource`, so an
  auxiliary containment triple written at creation would never be removed —
  another reason the guard belongs in the store, not in the reader.
- The registry service has no root storage in the same sense as the data
  service; the `LwsSubscriptionStorage` override uses the Postgres key-value
  store for both.
- `LwsSubscriptionStorage` override needs `"@type": "LwsSubscriptionStorage"`
  in `overrideParameters` (the `storage` predicate is not globally in the
  context).
- The registry set/dedicated registries are path-based bootstrap structure;
  only the flat store's POST allocation honors UUID slugs. The registry
  members are still PUT with path-based IRIs (see §2).
- **Do not HEAD a storage root with a wildcard/absent `Accept`.** A registry
  set (and a pod root) is a storage root: `LwsStorageDescriptionHandler`
  (`wildcardDescribes: true`) answers with the public storage description
  (`application/lws+cid`), whose links have no `rel="acl"`/`rel="describedby"`.
  Send a concrete type (`AUXILIARY_DISCOVERY_ACCEPT`) — that is what
  `discoverAccessResource` / `discoverDescriptionResource` do. Nested
  containers (e.g. `…/grant/`) are unaffected and do return the aux links.
- The latest local CSS is ahead of the fork remote; `fork-css`/CI will keep
  using `01ad3376` until the branch is pushed.
- The compose stack mounts the repo; a components change needs
  `npm run build --workspace @elfpavlik/sai-components` and a restart of the
  consuming service (`auth`, `data`, `registry`).
- `devbox run local-css` leaves `node_modules/@solid/community-server` as a
  symlink **outside** the repo, and Dagger only ships the repo — so a plain
  `dagger call` after `local-css` can not resolve CSS. Either copy the fork
  build into `node_modules/@solid/community-server` (real directory, no flag)
  or pass `--css=../CommunitySolidServer`.
- `--css` mounts the checkout at `/sai/node_modules/@solid/community-server`,
  but that path is a **symlink**: the mount is placed at its target
  (`$HOME/.npm-global/lib/node_modules/@solid/community-server`) inside the
  container, and the link then follows it — verified with
  `ls`/`require.resolve` in a container (`require.resolve` reports the target
  path, and the server runs from the mounted build). So the flag works, but
  the resolved location is the `npm link` target, not the repo path.
