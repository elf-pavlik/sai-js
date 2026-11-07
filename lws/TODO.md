# Flat LWS storage — next session plan

Single source of truth for the remaining work. The data and registry services
run **LWS-only flat storage**; the SAI access layer uses **`lws:contains`** for
containment and **`lws:partOf`** for the parent; the fixture and account
bootstrap template carry `lws:contains` / `lws:partOf`; storage discovery
(`rel="storage"` → `lws:StorageRoot`) is implemented. The **client auth
migration (§1) is done and verified live** — SAI sessions, the UI token
endpoint, and data/registry reads and writes work against the compose stack.

## Current state (check before starting)

- Last commit: `a04c032c initial alignment with LWS` (same content as the
  earlier `c73083db` after the rebase).
- Working tree (uncommitted, this session):
  - `packages/utils/src/lws-auth.ts` (new) — LWS AS discovery, token exchange
    with DPoP proof, `createLwsFetch`, `requestLwsAccessToken`.
  - `packages/utils/src/jsonld.ts` — container RDF fallback (`text/turtle`)
    when an LWS-only server answers `application/ld+json` with the LWS JSON
    page listing.
  - `packages/utils/src/container.ts` — `postForIri` sends a `Content-Type`
    (the flat store rejects POST without one).
  - `packages/components/src/SessionManager.ts` — `.sai` DPoP vs data/registry
    LWS fetch split; `getLwsAccessToken()`.
  - `packages/components/src/SelfIssuedSession.ts` — `azp` claim = agent id
    (becomes the LWS token's `client_id`).
  - `packages/components/src/LwsTokenHandler.ts` (new) + route in
    `config/http/handler/default.json` — `/.sai/lws-token?resource=…`.
  - `packages/components/src/AdminPermissionReader.ts` — owner all-permissions
    now includes `Append` (LDP POST).
  - `packages/components/config/storage/flat-sparql.json` — incoming data is
    converted to `internal/quads` (the flat registry store writes to the
    SPARQL accessor).
  - `packages/components/config/storage/no-cache.json` (data) /
    `no-cache-flat.json` (registry) — **bypass the LWS representation cache**
    (`ResourceStore_Cached`). It caches a HEAD's representation (body destroyed
    by the handler) and serves the empty body to later GETs; it also served a
    stale peer registration to the mirror sync. This fixes the `discovery`
    failures and the stale peer read in reconciliation's peer-freshness test.
  - `packages/utils/src/lws-auth.ts` — service-path token selection: a known
    storage on the same server supplies the token for `/.notifications/…`
    (the handlers authorize the decoded topic). Restricted to real service
    paths (`/.notifications/`): other unknown URLs on the same origin are
    resources in **another storage** (e.g. a peer registration) and must use
    the challenge storage. Regression fix for the peer-fetch 401s
    (`reconciliation`); unit tests + live peer-registration check added.
  - `packages/components/config/overrides/lws-notification-service-paths.json`
    (new, **not imported yet**): extends the LWS extractor's `servicePaths` to
    `/.notifications/`; requires the fork HEAD (`servicePaths` arg), so import
    it only after `fork-css`.
  - `packages/authorization-agent/src/{sparql,data-instance,authorization-agent,agent-registry,role-registry,activity-registry}.ts`
    — `getContainingContainer` (`lws:partOf`), flat `loadDataInstance`,
    `findDataRegistration` uses the data pod's endpoint, registry member
    listings use `containedIrisJsonLd` (`ldp:contains` ∪ `lws:contains`);
    `findRolesWithMember` / `getOpenAccessRequestsOnRegistry` read both
    graphs.
  - `packages/utils/src/jsonld.ts` — `containedIrisJsonLd` union helper.
  - `packages/components/src/temporal/activities/admin.ts` — `findAdminGrants`
    uses the union helper.
  - `packages/data-model/src/{context,data-registration}.ts` — `lwsPartOf`
    term, `DataRegistrationData.partOf`.
  - `packages/components/src/services/{queries/org,ShareResource,DataRegistry}.ts`
    — flat registration resolution in the personal/org contexts.
  - `examples/vuejectron/src/store/app.ts` — UI `sessionFetch` with a
    `tokenSource` calling `/.sai/lws-token`.
  - `packages/components/test/lws-live.test.ts` (new) — live checks, skipped
    unless `LWS_LIVE` is set.
- Latest local CSS: `056080d7a` (`lws-sai`, rebased on the latest upstream).
  Fork remote `github/lws-sai` is still `01ad3376` — **push it** before
  `fork-css`/CI can use the latest.
- The compose stack currently runs the git CSS (`01ad3376`) with the new
  LWS-only data/registry configs. `01ad3376` predates
  `f22595778` (`verifyRestriction`, DPoP proof at the token endpoint) and
  `e09990fd9` (`resource_metadata` on 401s); the client supports both shapes.
- Verified (this session):
  - All package tests pass (utils 76, data-model 90, authorization-agent 136,
    components 208, application 7, test-utils 23), typecheck, lint, components
    build pass.
  - Live (`LWS_LIVE=1`, in the `worker` container):
    - `SessionManager.getSession` reads the LWS registry set (dan) and the
      registry-pod data (bob) with LWS tokens; `.sai` requests stay on DPoP.
    - Token exchange with the self-issued ID token works against the running
      `01ad3376` data/registry servers (D-PoP-bound `cnf` proof is optional
      there, required on the fork HEAD).
    - `/.sai/lws-token` mints a storage token for the UI session.
    - Data instance: POST (empty JSON-LD) + PUT (expanded JSON-LD) + GET +
      DELETE in a flat registration; the registration is resolved through
      `lws:partOf`.
    - Social-agent registration: `createContainer` (PUT + `.meta` PATCH) +
      `.acr` PUT + listing + read-back + DELETE.
    - Peer registration fetch across storages on the same server
      (`https://reg.docker/acme/social-agent/m4k9wp/` as bob) — the
      peer-fetch regression fix.
    - Binary `PUT → HEAD → GET` returns the body (the representation-cache
      bypass; the `discovery` failure).
  - Dagger: `agents`, `authorizations`, `agent-discovery`, `check-equivalence`,
    `discovery`, `key-scoping` and `reconciliation` (all 4) pass.
  - Re-seeded Fuseki: `reg-dan` has `lws:contains` on the registry set and the
    social-agent registry; data pods have `lws:contains` / `lws:partOf` and no
    `ldp:contains`.
  - Storage descriptions: `https://bob.data.docker/` and
    `https://reg.docker/dan/` return `application/lws+cid` with
    `rel="https://www.w3.org/ns/lws#storage"` and a `StorageRoot` service.

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
- [ ] `test-client` keeps hierarchical IRIs with LWS metadata; `shapetrees`
      has no LWS metadata (container listings empty under the flat store;
      direct fetches work). Add LWS metadata if listings are needed.

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
- [ ] UI notification stream: `NotificationManager` uses the LWS session
      fetch; `createLwsFetch` now sends a same-origin storage token for
      `/.notifications/…` service paths, and the handlers authorize the decoded
      topic. Still blocked by the installed CSS `01ad3376` lacking
      `servicePaths` — see §8 (push the fork, import the notification
      override).
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
- [ ] Run the dagger integration suite (see the table below). The suite
      mounts the working tree and the **built** `packages/components/dist`, so
      rebuild before running:
      `npm run build --workspace @elfpavlik/sai-components`.
      Run: `dagger call test` (CI uses this); narrow with
      `dagger call test --testFile="agents.test.ts share.test.ts"` and
      `--only="<test name>"`.

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

### Dagger suite status (after the §1–§4 fixes)

Legend: ✅ expected pass · 🔎 run to verify (code path changed this session) ·
⛔ blocked (blocker in brackets).

Recommended first run (7 files, ~10 min):

```bash
dagger call test --testFile="agents.test.ts authorizations.test.ts key-scoping.test.ts"
dagger call test --testFile="agent-discovery.test.ts discovery.test.ts check-equivalence.test.ts reconciliation.test.ts"
```

(`discovery` and `reconciliation` are both verified — keep them in the
regression baseline.)

Verified since then (all green): `services`, `authorization-revocation`,
`delegation-endpoint`, `access-request`, `admin-events`, `personal-admin` —
the §7 helper batch plus the auxiliary-member / storage-root-ACL fixes they
exposed.

Next run — the last two non-§8 files (second attempt). **Rebuild components
first** (`peerRegistrationOfInstance`, `fetchPeerResource`, `ProxyAdminHandler`
changed):

```bash
npm run build --workspace @elfpavlik/sai-components
dagger call test --testFile="policy-engine.test.ts org-context.test.ts"
```

After that only the §8 notification-service work remains (`invitation`,
`federation-mirror`, `reciprocal-webhook`, `roles`, `share`, `authorization`):
with `local-css` those can be exercised through the `--css` constructor
argument (see §8) — no fork push needed until CI.

Fixture change this session: the `data/shapetrees` pod now has LWS storage
metadata (`meta:` root typed `DataRegistry`/`Storage`, `trees/` as an
`ldp:Container` registration listed with `lws:contains`, and `lws:partOf` on
each shape tree). Its listings are no longer empty (§4).

| test file | covers | status | blocker / note |
|---|---|---|---|
| `agents.test.ts` | `.sai/agents` HEAD for the seeded agents | ✅ | — |
| `agent-discovery.test.ts` | AgentIdHandler registry/redirect links, client-id doc | ✅ (verified) | registry listings now `lws:contains` (`containedIrisJsonLd`) |
| `authorizations.test.ts` | `ListAuthorizations` RPC (SPARQL) | ✅ | — |
| `check-equivalence.test.ts` | grant regeneration keeps IRIs | ✅ (verified) | activity listing (`getActivityIris`) + registry writes |
| `discovery.test.ts` | discovery helpers against live servers | ✅ (verified) | two tests failed on the LWS representation cache (HEAD cached empty body); fixed by `no-cache.json` |
| `invitation.test.ts` | invitation → reciprocal → activity completion | 🔎 (rerun) | the `invalid_target` webhook blocker is gone (fork HEAD + `servicePaths` override; `CreateInvitation` returns 200 in isolation). An earlier batch run showed transient 500s/401s from a cold stack (Fuseki/Temporal/Garage still starting) |
| `key-scoping.test.ts` | per-pod Garage buckets/keys | ✅ | — |
| `reconciliation.test.ts` | reconciliation sweep (Temporal) | ✅ (verified) | all 4 failed on the **peer-fetch 401 regression** (the service-storage heuristic sent bob's registry token to acme's registration); fixed + verified live (peer registration 200). The cache fix (`no-cache.json`) also applies; DELETE 204 accepted |
| `org-context.test.ts` | org registry set, roles, admin gating, peer proxy | 🔎 (rerun) | first run: everything but `GetResource` passed. `GetResource` needs the peer *registration* of an instance — the org can not read the peer's `lws:partOf` (pod outside its endpoint allowlist, `.meta` denied), so `peerRegistrationOfInstance` now asks the granted registrations through `/proxy-admin` |
| `services.test.ts` | service health | ✅ (verified) | data pod's wildcard/absent-`Accept` GET is the public **200** `application/lws+cid` storage description |
| `access-request.test.ts` | need-based access request flow | ✅ (verified, 3/3) | sent + both receive-side tests; `storedAccessRequests` reads the flat registry through `containedIris` on the LWS session fetch |
| `admin-events.test.ts` | admin event forwarding + ACR rewrite | ✅ (verified, 7/7) | the 4 admin tests had timed out on `syncAdminAcr` (no `acl` link on the registry set — a storage root; wildcard HEAD returns the LWS storage description). Fixed via `discoverAccessResource` + `AUXILIARY_DISCOVERY_ACCEPT`; `adminGrantIris` reads the flat GrantRegistry through `containedIris` |
| `personal-admin.test.ts` | personal admin promote/demote | ✅ (verified, 3/3) | same `syncAdminAcr` root cause (registry-set ACL discovery on a storage root); `adminGrantIris`/`fetchRegistrySetAcr` migrated |
| `authorization.test.ts` | authorize/deny/approve access request | ⛔ partial | the two AccessRequestRegistry reads are migrated (`containedIris`); `creates denied authorization` and the approve test still need the §8 notification service (`awaitGrantCompletion`) |
| `authorization-revocation.test.ts` | revoke authorizations/grants | ✅ (verified) | `countContained` reads the flat registry through `containedCount` on the LWS session |
| `delegation-endpoint.test.ts` | delegation issuance/revocation | ✅ (verified) | `countGrants` via `containedCount`; the direct DELETE carries the storage's LWS token (read-only ACR → 403). The aux-member filter (`<grant>.acr` was counted as a member) made the counts exact |
| `federation-mirror.test.ts` | reciprocal mirror replication | ⛔ | §8 notification service (`awaitGrantCompletion`) |
| `policy-engine.test.ts` | SAI policy engine over HTTP | 🔎 (rerun) | first run 74/82: (a) `https://data/shapetrees/` was not an LWS storage (fixture had no root/container metadata → token exchange `invalid_target`; added `meta:` root + `trees/` container + `lws:partOf` on the shape trees), (b) `can Create` rewritten to the flat flow (POST to the Task registration container → PUT at the `Location`); `buildLwsFetch` + `205` → `204` as before |
| `reciprocal-webhook.test.ts` | reciprocal webhook + events | 🔎 (rerun) | the events test passes on the fork HEAD with the `servicePaths` override (the worker's webhook POST to `.notifications/` now mints/accepts a storage token). The `id` test opened the stream with **`.sai` DPoP** (`HEAD …/cvmsa4/ → 401`, then `GET …/.notifications/StreamingHTTPChannel2023/b0 → 500` per the Tempo trace) — now uses the session's LWS fetch |
| `roles.test.ts` | role CRUD + `AllFromRole` grants | 🔎 (rerun) | all three session bootstraps and the `CreateInvitation` RPC verify healthy in isolation (the 401s came from a cold-starting stack); `awaitGrantCompletion` already takes `session.fetch` |
| `share.test.ts` | share a data instance | ⛔ | §8 notification service (`awaitGrantCompletion`); the `ShareResource` RPC + `ListDataRegistries` poll is otherwise the best live check of the flat fixes; the streaming barrier needs the §8 notification service |

Blockers referenced above:

- **§8 notification service (fork CSS)** — the worker's reciprocal webhook
  (`POST https://<server>/.notifications/WebhookChannel2023/`) and the test/UI
  streaming channel (`GET https://<server>/.notifications/StreamingHTTPChannel2023/<encoded topic>`)
  are Solid notification service paths. The installed CSS `01ad3376` has **no
  `servicePaths`** argument on `LwsAccessTokenExtractor`, so it validates the
  token against the channel target (`.notifications/`, not a storage) and the
  challenge `realm` is `.notifications/` → the token exchange fails with
  `invalid_target`. The fork HEAD (`056080d7a`) has `servicePaths`; after
  `push` + `fork-css`:
  1. import `sai:config/overrides/lws-notification-service-paths.json` in the
     data/registry configs (it sets `servicePaths: [ ".notifications/" ]`);
  2. `createLwsFetch` already sends the topic's storage token for service
     paths (storage on the same origin), and the handlers authorize the
     decoded topic.
  Until then the invitation/notification-dependent tests stay blocked; this
  also blocks the UI notification stream (§6).
- **§7 test helpers (done)** — containment reads go through
  `containedIris` / `containedCount` (`test/util.ts`, the
  `ldp:contains` ∪ `lws:contains` union) on the session's LWS fetch. Flat
  registry/data members are `lws:contains` only, so a raw
  `linkedIrisJsonLd(..., LDP.contains)` or an `ldp:contains` quad count comes
  back empty.
- **§7 DPoP test clients (done)** — storage requests use
  `buildSessionManager().getSession(...)` or the new `buildLwsFetch(webid,
  clientId?)` (LWS storage counterpart of `buildOidcSession(...).authFetch`);
  `.sai` requests keep DPoP.
- **§7 status codes (done)** — LWS returns `204` after PUT/PATCH/DELETE.
- **§3 peer proxy (done)** — `fetchPeerResource` reads the peer document
  through `fetchJsonLd` (LWS profile → RDF fallback for a page-listing
  container) and the handler serves that JSON-LD, instead of pinning
  `Accept: application/ld+json` and forwarding the unframeable bytes.
- **§7 storage description** — the data pod now serves the public LWS storage
  description (200) for a wildcard/absent `Accept`; update the `services`
  expectation and any storage-description assertions.
- [ ] `docs/website/public/likec4-webcomponent.js` is generated and was skipped
      by the IRI rewrite; regenerate the docs bundle if the site should show
      the flat IRIs.
- [ ] Update `README.md` / `first-look.md` to the LWS-only mode (the current
      notes still describe the Solid/dual config).
- [ ] OpenWiki is generated; do not hand-edit.

## 8. Dev / CI / images

- [ ] CSS builds: what a run uses.
      - **Dagger (`dagger call test`) and the compose stack** resolve
        `node_modules/@solid/community-server`. After `devbox run fork-css`
        that is a real directory installed from the git ref in
        `package-lock.json` (`01ad3376`); after `devbox run local-css` it is an
        npm **symlink** to `$NPM_CONFIG_PREFIX/lib/node_modules/…` →
        `../CommunitySolidServer`.
      - A symlink that leaves the repo **does not survive the Dagger mount**
        (only `source` is shipped), so with `local-css` the containers can not
        resolve CSS at all. That is why the suite was pinned to the pushed
        git ref — not because pushing is inherently required.
      - Two ways to feed the local fork to Dagger (both verified):
        `cp -a ../CommunitySolidServer node_modules/@solid/community-server`
        after `npm run build` in the fork (a real directory inside the mount,
        no flag), or the `--css=../CommunitySolidServer` constructor argument
        (mounted **over** `node_modules/@solid/community-server` in every Node
        container; nested Dagger mounts resolve inner-mount-wins). `--css` is a
        constructor argument — like `--tempo-endpoint` it goes *before* the
        function name (`dagger call --css=… test …`), never after it.
        `devbox run fork-css` restores the locked git install.
      - **Copy the fork WITH its `node_modules`, then delete one package**
        (`cp -a ../CommunitySolidServer node_modules/@solid/community-server`
        + `rm -rf node_modules/@solid/community-server/node_modules/@solid/access-token-verifier`).
        Two reasons this exact shape is needed:
        1. the fork's own install carries stock
           `@solid/access-token-verifier@2.1.1`, which shadows this repo's
           `overrides` fork (`2.1.2`, the one that whitelists the `QUERY`
           method). The verifier then logs `Error verifying WebID via
           DPoP-bound access token: Expected [object Set], got: QUERY`,
           `UnionCredentialsExtractor` swallows the error (`ignoreErrors`) and
           falls back to public credentials → `.sai/sparql-admin` answers
           `403 this endpoint requires credentials`;
        2. dropping the **whole** nested tree breaks boot:
           `Cannot find module 'cluster-key-slot'` (the repo's hoisted
           `ioredis` has its transitive deps only inside the fork's tree).
        Verify with `node -e "console.log(require.resolve(
        '@solid/access-token-verifier', { paths:
        ['node_modules/@solid/community-server'] }))"` (must be the repo root,
        `REQUEST_METHOD` must contain `QUERY`) and a host boot smoke test
        (`node node_modules/@solid/community-server/bin/server.js -c
        @css:config/default.json -p 3999 -b http://localhost:3999/`).
        The `--css` mount has the same verifier caveat (the mounted checkout's
        own `node_modules` participates in resolution).
      - **Preferred**: push the fork branch and run `devbox run fork-css`.
        npm then applies this repo's `overrides` at install time (a single
        hoisted `@solid/access-token-verifier@2.1.2` with `QUERY`, a complete
        dependency tree), which removes both hand-copy caveats above. Same
        requirement for CI.
      - Client-side hardening stays in place regardless (`isAuxiliaryResource`
        filters `.acr`/`.acl`/`.meta` members in `containedIrisJsonLd` and
        `listContained`, see §7), so the suite is green on `01ad3376` too.
- [x] Import
      `sai:config/overrides/lws-notification-service-paths.json` in
      `data.json`/`registry.json` (done on the fork HEAD; the parameter exists
      in its generated component `#LwsAccessTokenExtractor_args_servicePaths`
      and both configs load). Evidence it works: `reciprocal-webhook`'s
      `emits pending and done events…` test passes — the delegated-grants
      chain completes, which needs the worker's webhook POST to
      `.notifications/WebhookChannel2023/` to be authorized. Remaining: the
      streaming-channel tests must use the **LWS session fetch**, not `.sai`
      DPoP (`reciprocal-webhook` `id` fixed; other §8 files already pass
      `session.fetch` into `awaitGrantCompletion`).
- [ ] `local-css` is host-only: the compose stack/dagger cannot follow the
      host `node_modules` symlink (`/CommunitySolidServer` is outside `/sai`,
      and Components.js cannot see `/sai/node_modules` from there). Use
      `fork-css` for the stack, or mount the fork under
      `/sai/CommunitySolidServer` and run the server from that path.
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
