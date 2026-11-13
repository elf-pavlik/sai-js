# LWS alignment plan

Status: **Phase 1 complete (interim shape)** — 2026-11-11. Phase 2 Step 0
replaces the Phase 1 grant/request shape with the frozen ODRL contract.

This supersedes the earlier LWS exploration notes, which were removed during
the 2026-11-11 cleanup. This document is the target design and the phased work
plan; [`TODO.md`](./TODO.md) tracks the remaining Phase 0 / Phase 2 handoff and
non-plan infrastructure work.

**Phase 1 is done and the full Dagger suite is green.** Its grant/request shape
is superseded by the Phase 0 wire contract; Phase 2 Step 0 is effectively a
Phase 1 redo of the data model against that contract, keeping the current
protocol.

> Agreed Phase 0 wire payloads are recorded in
> [`phase-0-wire-contract.md`](./phase-0-wire-contract.md). Where a payload
> sketch below differs, the wire contract is authoritative.

### Phase 1 implementation summary

- Actions are canonical IRIs (`odrl:read`, `odrl:modify`, `lws:create`,
  `odrl:delete`); ACL/ACP terms remain only in ACR/ACP metadata.
- A grant is one `lws:AccessGrant` RDF resource with `storage`, `access[]`, and
  `interop:` SAI extension fields. The legacy flat grant fields
  (`grantee`, `accessMode`, `hasStorage`) and the `interop:DataGrant` type are
  gone.
- Grant generation, issuance, SPARQL readers, policy engine, chain,
  revocation closure, federation mirror, registration projections, ACRs, and
  application/UI reads use the canonical shape.
- Seeds (`environments/data/registry.trig`) and fixtures
  (`packages/test-utils/src/data.json`) are canonical.
- Admin grants are canonical too (`interop:AdminGrant` + `lws:AccessGrant`).
- Code-facing terminology is normalized to “access grant”; the only remaining
  `DataGrant` spelling is the wire link predicate
  `interop:hasDataGrant` (see divergences).
- Package tests and the full Dagger integration suite pass.

---

## 1. Target model

Keep the SAI authorization model as the source of truth, and make the
grant/request resources LWS-shaped.

```text
AccessRequest (needs / delegation / revocation)
        │
        ▼
SAI activity + AccessRequestRegistry
        │
        ▼
DataAuthorization  ──────────────────► source of truth
        │
        └──► LWS AccessGrant + ACR ───► SAI enforcement, delegation, reconciliation
                 (one RDF resource in the GrantRegistry)
```

Rules:

- `DataAuthorization` remains the mutable source.
- The materialized grant is an **LWS `AccessGrant` RDF resource** with SAI
  extension fields. There is no separate `DataGrant` resource and no separate
  LWS projection.
- The grant lives in the owner’s `GrantRegistry` as an RDF named graph, so the
  existing SPARQL, chain, federation, registration, and ACR machinery still
  works. It is not stored under `.lws/grants/`.
- `application/lws+json` and `application/lws+cid` are parsed as RDF through
  the bundled LWS context; the SAI handlers write/read RDF, not a second JSON
  store.
- Only the owner Temporal workflow physically deletes grants, including during
  re-projection/revocation.
- No mirrored/peer-owned grants are returned by an owner’s grant endpoint.
- Breaking changes are allowed. No dual support for the old `.sai/grants`
  issuance message shapes.
- Access-grant terminology is used consistently in code, tests, and comments;
  `interop:hasDataGrant` stays as the registration → grant link predicate.

### Endpoint model

Owner-scoped SAI endpoints, backed by the existing registries:

| Endpoint                                   | Methods                                                           | Backing store                             | Purpose                                                  |
| ------------------------------------------ | ----------------------------------------------------------------- | ----------------------------------------- | -------------------------------------------------------- |
| `/.sai/access-requests/<base64url(owner)>` | `POST` (custom SAI handler), `GET`/`HEAD` container/member facade | `AccessRequestRegistry`                   | needs requests, delegation requests, revocation requests |
| `/.sai/grants/<base64url(owner)>`          | `GET`/`HEAD` only                                                 | `GrantRegistry` + registration projection | LWS `AccessGrant` read view                              |

- No `PUT`.
- No client-side `DELETE` in the first slice. The owner workflow can delete
  request/grant resources. A later request-cancel feature can delegate to the
  registry member `DELETE`.
- `Location` for a created request is the **registry IRI**, not a member IRI
  under the endpoint. This is a documented divergence from LWS container
  semantics.
- The endpoint is owner-scoped, not storage-scoped. It is advertised in the
  owner’s storage description(s) and WebID/ClientID CID documents.

---

## 2. Vocabulary and wire model

### 2.1 Actions

**Status: implemented in Phase 1.**

Use the LWS actions as IRIs (compact terms are accepted under the LWS context):

| SAI old value | Canonical new value                  | Compact  |
| ------------- | ------------------------------------ | -------- |
| `acl:Read`    | `http://www.w3.org/ns/odrl/2/read`   | `read`   |
| `acl:Update`  | `http://www.w3.org/ns/odrl/2/modify` | `modify` |
| `acl:Create`  | `https://www.w3.org/ns/lws#create`   | `create` |
| `acl:Delete`  | `http://www.w3.org/ns/odrl/2/delete` | `delete` |

There is no `Control` in SAI grants. Keep ACL/ACP terms only for ACR/ACP
metadata; they are a different layer.

The canonical SAI `interop:accessMode` values switch to the four IRIs above.
This is a breaking migration of seeds, fixtures, data model, API messages, UI,
tests, and policy-engine mappings.

### 2.2 LWS context and SAI profile

The LWS context is bundled locally at
`packages/utils/src/lws-v1-context.ts` and registered in the local JSON-LD
document loader under `https://www.w3.org/ns/lws/v1`. The upstream context is
not published yet; the local copy also carries three fixes pending an upstream
PR:

- `odrl:assignee` is coerced to `@type: @id` (otherwise the agent becomes an
  RDF literal);
- `odrl:target` gets a scoped `value` mapping to `lws:value`, so target values
  survive JSON-LD expansion;
- `storage` is defined at the top level (upstream scopes it only inside
  `AccessRequest`/`AccessGrant`), so permission targets can use it;
- the top-level `@protected` flag is removed so the LWS, ODRL, and SAI
  contexts compose in one document (nested scoped contexts stay protected).

SAI profile terms live in the existing **`interop:` namespace**; do not
introduce a separate `sai:` namespace. The exact profile URI, context document,
and term list are frozen in Phase 0.

Reuse existing `interop:` terms where they already model the concept:

- `interop:grantee`, `interop:requester` (renamed `grantedBy`),
  `interop:dataOwner`
- `interop:registeredShapeTree`
- `interop:hasDataRegistration`, `interop:hasDataInstance`
- `interop:scopeOfGrant`, `interop:scopeOfAuthorization`
- `interop:inheritsFromGrant`, `interop:inheritsFromAuthorization`
- `interop:satisfiesAccessRequest`, `interop:satisfiesAccessNeed`
- `interop:hasAccessNeedGroup`, `interop:hasAccessNeed`, `interop:accessNecessity`

Add profile terms only where needed, for example:

- `interop:AccessProfile` (profile URI in `conformsTo`)
- `interop:requester` (renamed `grantedBy`)
- `interop:AccessRevocationRequest`
- `interop:DelegationRequest`
- `st:ShapeTree` (shapetrees target matcher; not an `interop:` term)
- `interop:DataRegistration` as an additional target type
- target `storage` (envelope-level storage is dropped)
- ODRL terms come from the ODRL context, not from redefining them in
  `interop:`

Grants use `AccessGrant` + ODRL `Agreement` policies in `access[]`. Request
and grant permissions carry `assigner` = data owner, `requester` = renamed
`grantedBy`, and `assignee`; each target carries `storage`, `type`, `uid`, and
`source`. The `interop:hasDataGrant` link predicate is retained on
registrations; it is the registration → grant projection link, not the grant
resource type.

### 2.3 Access requests

**Status: pending — Phase 2.** The existing `.sai/grants` POST dispatch remains
until the access request endpoint lands.

The needs-based request is frozen in
[`phase-0-wire-contract.md`](./phase-0-wire-contract.md): `lws:AccessRequest`

- `interop:NeedBasedAccessRequest`; no `storage`/`inbox`; `access[]` holds ODRL
  `Request` policies with `uid`, `profile`, and `permission[]`. Each permission
  carries `assigner` (data owner), `requester` (renamed `grantedBy`), `assignee`,
  `action`, and one target. The `AccessNeed`/`AccessRequired` types and
  `inheritsFromNeed` preserve need semantics; targets use `st:ShapeTree`.

Delegation requests use a top-level array of parent-tree `AccessRequest`
envelopes (`DelegationRequest`). Each envelope's `access[]` holds ODRL `Request`
policies for the parent and its children; policies link with
`inheritsFromGrant`. There is no envelope-level `storage`, requester, or data
owner. The first slice preserves the current validation and synchronous
issued-grants response as a documented SAI-profile divergence; a later phase
can switch to `202` + notification + grant read.

Revocation requests use the same envelope with
`type: [AccessRequest, interop:AccessRevocationRequest]` and
`interop:grants` carrying the grant IRIs. The full payload is still pending
Phase 0 review.

Revocation keeps current SAI behavior:

- authorized caller only (owner or grantor UAS; grantee self-revocation remains
  not offered),
- batch/all-or-nothing,
- C1 closure,
- automatic (no human approval in the first slice),
- physical deletes run in the owner Temporal workflow.

### 2.4 Access grants

**Status: implemented in Phase 1.**

> Phase 2 Step 0 migrates this shape to the ODRL/issue-303 form frozen in
> [`phase-0-wire-contract.md`](./phase-0-wire-contract.md): `Agreement` policies,
> `uid`/`profile`/`permission[]`, permission-level
> `assigner`/`requester`/`assignee`, and target
> `storage`/`type`/`uid`/`source`. The Phase 1 JSON sketch below is superseded
> by that contract.

There is one grant resource. It is an LWS `AccessGrant` document with SAI
extension fields; `interop:DataGrant` is not used as a separate type in the end
state.

```json
{
  "@context": ["https://www.w3.org/ns/lws/v1", "<sai-profile-context>"],
  "id": "<grant IRI>",
  "type": ["AccessGrant"],
  "storage": "<target storage>",
  "access": [
    {
      "type": ["AccessPolicy"],
      "assignee": "<grantee>",
      "action": ["<odrl:read|odrl:modify|lws:create|odrl:delete>"],
      "target": {
        "type": "<lws:DataResource|lws:Container|lws:StorageResource|interop:ShapeTree>",
        "value": ["<target IRIs>"]
      }
    }
  ],
  "interop:grantedBy": "<grantor>",
  "interop:dataOwner": "<data owner>",
  "interop:scopeOfGrant": "<scope>",
  "interop:registeredShapeTree": "<shape tree>",
  "interop:hasDataRegistration": "<registration>",
  "interop:hasDataInstance": ["<instances>"],
  "interop:inheritsFromGrant": "<parent grant>",
  "interop:hasInheritingGrant": ["<child grants>"],
  "interop:satisfiesAccessRequest": "<...>",
  "interop:satisfiesAccessNeed": "<...>"
}
```

Canonical fields:

- `storage`, `access[].assignee`, `access[].action`, `access[].target`, and
  `access[].constraint` are the LWS truth.
- SAI extension fields carry what LWS does not model: `grantedBy`,
  `dataOwner`, `scopeOfGrant`, `registeredShapeTree`, registration/instance
  scope, inheritance, and provenance.
- The implemented `GrantData` POJO has no flat `grantee`, `accessMode`, or
  `hasStorage` fields; helpers derive `grantGrantee()`/`grantAccessModes()`
  from `access[]` where a single value is needed. The RDF resource has one
  truth.
- The grant type is `lws:AccessGrant` only; `interop:DataGrant` is removed.

Admin grants use the same resource shape with `interop:AdminGrant` as an
additional envelope type and `interop:scopeOfAdminGrant` as the envelope scope
extension. Their permission is read-only; the target `storage` is the registry
set for `RegistrySet` scope and the data registry for `DataRegistry` scope,
with an `lws:Storage` target type.

Target mapping (Phase 2 Step 0):

| SAI scope              | Target                                                                                |
| ---------------------- | ------------------------------------------------------------------------------------- |
| `SelectedFromRegistry` | one permission per resource; `Asset` target with `storage`, `source` = instance       |
| `AllFromRegistry`      | `AssetCollection` + `DataRegistration` target with `storage`, `source` = registration |
| `AllFromAgent`         | `SocialAgent` target with `source` = agent                                            |
| `Inherited`            | same as `AllFromRegistry`; policy `inheritsFromGrant`                                 |

The LWS target types are not recursive in current CSS. This is a documented
divergence until the SAI profile target matcher exists. SAI clients use
`interop:scopeOfGrant`/related fields; standard LWS clients see the closest
target representation.

Implementation note: Phase 1 writes the child registration as the `Inherited`
target (self-contained, matching the seed fixtures) rather than copying the
parent grant target. The parent relationship remains
`interop:inheritsFromGrant`; revisit this in Phase 0/2 if the profile target
matcher needs the literal parent-target semantics.

Store the document as RDF (resource graph + `meta:` twin as today) and frame it
back to the compact LWS shape on read. Do not store a raw JSON copy under
`.lws/grants/`.

### 2.5 Roles

Verified in the current generation path: roles are authorization subjects or
`dataOwner` values, but materialized grants always carry a concrete agent as
the grantee/assignee. Role grantees are expanded by the workflow
(`getGrantees`) before `reconcileGrantsForGrantee`; `AllFromRole` iterates role
members and still passes the concrete grantee. The grant endpoint therefore
does not expand roles; it filters by `access[].assignee`.

Regression coverage is in place (`test/roles.test.ts`): a role/`AllFromRole`
grant materializes one grant per member and asserts the concrete
`access[].assignee`, never the role IRI.

---

## 3. Endpoint contracts

**Status: pending — Phase 2.** The current protocol still uses the
`/.sai/grants` POST issuance route.

### 3.1 Access request endpoint

`POST /.sai/access-requests/<base64url(owner)>`

- Authenticate and require the caller’s UAS client, as today.
- Parse a JSON-LD LWS `AccessRequest`.
- Dispatch on type:
  - needs request → validate registration/self-request; mint owner-side
    request IRI; write `NeedBasedAccessRequestReceived`; materialize request;
    return `202`/`201` per contract.
  - delegation request → current chain validation and issuance behavior;
    document synchronous response divergence.
  - revocation request → current authority/closure/revocation behavior;
    physical deletes via owner workflow.
- `Location` = the request registry IRI.

`GET`/`HEAD` container/member: facade over the owner’s
`AccessRequestRegistry`. Implement by rewriting the endpoint target to the
registry IRI and delegating to the regular LWS operation handler once the
credential check passes. This keeps LWS container/list/member reads while the
registry remains the backing store.

No `PUT`. No client `DELETE` in v1; the workflow owns deletion. Document this
divergence from the LWS request-cancel operation.

### 3.2 Access grant endpoint

`GET /.sai/grants/<base64url(owner)>`

- Owner credentials: return all grants from the owner’s grant registry whose
  `dataOwner` is the owner. Do not include peer-owned/mirrored grants.
- Any other authenticated agent: find the owner’s registration of the agent;
  return grants whose `access[].assignee` is the agent and `dataOwner` is the
  owner. Unregistered agents get `403`.
- Return the stored LWS `AccessGrant` documents directly, framed from their
  RDF graphs. There is no second mapping/projection step.
- No `POST`, `PUT`, or `DELETE` in v1. This is a read-only deviation from the
  current LWS draft; grant creation and deletion remain owner-workflow
  operations.

The endpoint is a view over the grant registry. The old `.lws/grants/` JSON
store, `AccessGrantReader`, and `.lws` access-document handlers are disabled in
SAI configs; there is one LWS-facing grant surface.

---

## 4. Discovery and CID

**Status: pending — Phase 2 step 6.**

Both WebID and ClientID support content negotiation for `application/cid`.
`application/lws+cid` remains the storage-description media type; agent CIDs use
`application/cid`.

Service entries to add to the user’s CID document:

- `interop:AuthorizationAgent`
- `lws:AccessRequestService` → owner access request endpoint
- `lws:AccessGrantService` → owner access grant endpoint

`interop:hasDelegationIssuanceEndpoint` is removed; the access request service
replaces it.

Implementation:

- Add service triples to the WebID/profile graph during account bootstrap and
  in `environments/data/registry.trig` (or the equivalent ClientID graph).
- Update `services/id/cid.ts` so those services survive profile → CID framing.
- Add `application/cid` negotiation to `AgentIdHandler` and `services/id`.
- Add discovery helpers for the access request/grant services from the CID or
  client-id document; update `discoverDelegationIssuanceEndpoint` callers.
- Add the owner-scoped endpoints to the owner’s storage description(s), using
  the LWS `AccessRequestService`/`AccessGrantService` service objects with
  `conformsTo` including the SAI profile.

CID is discovery-only for now. No SSI-CID/self-issued authentication work; no
verification methods required by this plan.

---

## 5. CSS fork / components changes

**Status:** pending — this section belongs to Phase 2. Phase 1 did not need CSS
changes because SAI grants are never written to `.lws/grants/`.

CSS:

- Update `AccessPolicy.action` handling to normalize action IRIs and compact
  terms (`odrl:read`, `odrl:modify`, `odrl:delete`, `lws:create`), not bare
  strings.
- Update `ACTION_MODES` and tests to key on the canonical IRIs.
- Add profile-aware target/action support only where SAI documents are
  validated/enforced by CSS. If SAI handlers own the profile, keep CSS changes
  minimal.
- Replace the `.lws` access-service describer/overrides in SAI configs with a
  SAI describer that advertises the owner-scoped endpoints. Disable the
  `.lws/grants`/`.lws/requests` initializer/reader and access-document handlers
  in SAI data/registry config; there is no separate `.lws` access store.
- Keep LWS storage description, token exchange, containment, and notification
  support.

SAI components:

- New `AccessRequestHandler` replacing `GrantIssuanceHandler` (or renaming and
  rewriting it) with the POST dispatch above.
- New `AccessGrantHandler` for the GET view.
- Registry facade helper for request GET/HEAD member/container reads.
- Update routers/config:
  - `/.sai/access-requests/*` → `AccessRequestHandler`
  - `/.sai/grants/*` → `AccessGrantHandler`
  - remove `.sai/grants` POST issuance route.
- Update `issuanceUrl`/discovery utilities and WebID template.
- Update API/UI access-mode values and any request/grant read models.

---

## 6. Data model and policy engine

**Phase 1 status: implemented.** The data-model, policy-engine, seeds, and
query work below is done. The SAI profile context/URI is the remaining Phase 0
piece.

Implemented:

- ODRL/LWS vocabularies and canonical actions (`ACCESS_ACTIONS`).
- Bundled LWS context (`packages/utils/src/lws-v1-context.ts`) with the local
  `assignee`/target-value fixes; registered in `localDocumentLoader`.
- Canonical `GrantData` (`storage`, `access[]`, `interop:` extensions), the
  `grantContext`/`lwsGrantContext` frames, and the access-grant
  builders/helpers.
- `interop:accessMode` values migrated; ACL only in `acr.ts` / ACP/ACR metadata.
- Policy-engine behavior preserved:
  - `lws:create` → `Create` + `Append`
  - `odrl:modify` → `Modify`
  - `odrl:read` → `Read`
  - `odrl:delete` → `Delete`
- Grant chain remains exact action-set based; no action hierarchy.
- Canonical seeds/fixtures and access-grant terminology throughout code/tests.
- SPARQL getters, policy-engine grant/admin matching, revocation authority,
  chain/equivalence, federation mirror, registration projection, and ACR reads
  use the canonical shape.

Still pending for Phase 0 / Phase 2:

- Published SAI profile URI/context and example documents.
- Formal mapping/divergence docs and profile round-trip tests.
- CSS action-IRI normalization when LWS access documents are enabled.
- The CSS `AccessPolicy.action` / `ACTION_MODES` changes listed in §5.
- Divergence note: `modify` also grants append in CSS and `create` is
  container-relative; a later alignment can tighten this.

## 7. Divergences to document

These are intentional and are documented here:

1. Owner-scoped SAI endpoints vs storage-scoped LWS services.
2. Request `Location` is a registry IRI, not a child of the endpoint.
3. No `PUT`; no client `DELETE` in v1; deletion is workflow-owned.
4. No public `POST`/`DELETE` on the grant endpoint; GET-only view.
5. Revocation is an access request, not `DELETE /grants/:id`; automatic and
   batch/closure-based.
6. Delegation issuance remains a SAI profile request with synchronous
   issued-grants response in the first slice.
7. LWS targets are non-recursive; SAI scopes are expressed via SAI extension
   fields until a target matcher exists.
8. `create`/`modify` policy-engine semantics differ from strict LWS operations.
9. CID is discovery-only; no SSI-CID authentication yet.
10. Grant view excludes mirrored peer grants.
11. Grants are stored as RDF named graphs in the GrantRegistry, not under
    `.lws/grants/`; the owner-scoped GET endpoint is the LWS service surface.
12. There is one materialized grant resource (LWS `AccessGrant` + SAI
    extensions), not a `DataGrant` plus an LWS projection.
13. `Inherited` grants target their own child registration container (plus
    `interop:inheritsFromGrant`), not the parent grant's target. Seeds,
    generation, and equality agree; revisit with the profile target matcher.
14. `interop:hasDataGrant` remains the registration → grant link predicate.
    Only the grant **resource type** `interop:DataGrant` was dropped.
15. The bundled LWS context carries local fixes for `odrl:assignee` IRI
    coercion, `odrl:target` `value` mapping, a top-level `storage` term, and
    the removal of the top-level `@protected` flag for three-context
    composition; these are pending an upstream PR to the LWS context.
16. Admin grants use the same canonical resource shape with
    `interop:AdminGrant` as an extra type; their `RegistrySet` target storage is
    the registry set and `DataRegistry` target storage is the data registry.
17. Code and test identifiers use “access grant”; the wire predicate
    `hasDataGrant` is the only intentional `DataGrant` spelling.
18. `access[]` items are ODRL `Request`/`Agreement` policies with
    `uid`/`profile`/`permission[]`; SAI extensions live on the permission
    (`assigner` = data owner, `requester` = renamed `grantedBy`, `assignee`).
19. Delegation requests are a top-level array of parent-tree envelopes; neither
    request nor grant carries envelope-level `storage`, `requester`, or
    `dataOwner`.
20. `SelectedFromRegistry` uses one permission per resource and a singular
    `target`; targets carry `storage`, `type`, `id`, `uid`, and `source`.
21. Needs requests have no `storage` by default; optional storage may be added
    later when the requester knows it.
22. The local ODRL context maps `uid` to `odrl:uid` (not `@id`); every ODRL
    policy, permission, and target carries `id` and `uid` with the same value.
    The LWS grant envelope uses `id` only.

---

## 8. Phases

This ordering is deliberate: **Phase 1 changed the data model, predicates, and
actions while keeping the current endpoints, message sequencing, activities,
and Temporal workflows.** Phase 2 Step 0 migrates that model to the frozen
ODRL shape; Steps 1–7 change only the protocol/transport. Every sub-step is
intended to land green-to-green.

### Phase 0 — freeze the wire contract (frozen)

**Status:** frozen. The profile URI/context, payload examples, context term
list, mapping table, and divergences are recorded in
[`phase-0-wire-contract.md`](./phase-0-wire-contract.md). Phase 2 Step 0 lands
the contexts and migrates the code to this contract.

- The SAI profile is `interop:AccessProfile`; the context is
  `https://www.w3.org/ns/solid/interop-context/v1`.
- Frozen examples: needs request, delegation request, revocation request,
  `AccessGrant`, admin grant.
- Contexts: LWS + local ODRL (`uid` → `odrl:uid`) + SAI; all bundled locally.
- Mapping tables and divergences live in the wire contract.
- Exit for Step 0: example documents expand/frame stably; full suite green; no
  protocol behavior changed.

### Phase 1 — data model, predicates, actions (current protocol) ✅

**Interim shape — superseded by Phase 2 Step 0.**

**Status: complete — full Dagger suite green.**

Keep the current `.sai/grants` POST dispatch, activity types, and workflow
sequencing throughout this phase. Delegation/revocation message payloads
changed because they embed grants and actions, but no endpoint or workflow step
changed.

Result:

- Canonical access-grant model and actions; no legacy grant fields/types.
- Canonical seeds/fixtures; admin grants included.
- Terminology normalized to “access grant” (wire link predicate excepted).
- Regression coverage for generation, chain, revocation closure,
  role-expanded grantee, reciprocal mirror, and delegation echo.
- Package tests + full Dagger suite green.

Operational note: terminology cleanup also renamed the Temporal activities to
`storeAccessGrant`, `deleteAccessGrants`, and
`replaceAccessGrantsOnRegistration`. In-flight workflows created by older
builds will not resolve the new activity names; restart/reseed dev stacks.
Phase 2 should use the renamed helpers (`getAccessGrant`, `getAccessGrantsForGrantee`,
`getAccessGrantIris`, `accessGrantAcrJsonLd`).

1. **Actions and vocabularies** ✅
   - Add ODRL/LWS vocabularies and replace ACL access modes in the SAI model,
     seeds, fixtures, tests, API, and UI.
   - Update `SaiPermissionsEngine`, `grant-chain`, and JSON-LD contexts.
   - Keep ACL/ACP terms for ACR/ACP metadata only.
   - Exit: no `acl:` values remain in grant/authorization/need access modes;
     tests green.

2. **Grant resource shape, compatibility step** ✅ _(intermediate; superseded by steps 3–4)_
   - Write grants as LWS `AccessGrant` RDF resources in the `GrantRegistry`:
     `storage`, `access`, and SAI extension fields.
   - Keep `interop:DataGrant` as an additional type and keep the old reader
     fields temporarily so current SPARQL/readers/workflows still work.
   - Parse `application/lws+json`/`application/lws+cid` as RDF in the local
     loader; store RDF named graphs, not a `.lws/grants` JSON copy.
   - Exit: all existing tests green with LWS-shaped grant resources; current
     protocol unchanged.

3. **Canonical read/write migration** ✅
   - Switch grant generation, SPARQL getters, equality/chain/revocation,
     federation mirror, registration links, ACR generation, and UI/API reads to
     `access[].action`/`assignee`/`target` + SAI extension fields.
   - Remove duplicate `interop:accessMode`, `interop:grantee`, and
     `interop:hasStorage` writes/reads.
   - Keep `interop:DataGrant` only as the query anchor where still needed.
   - Exit: all tests green; no duplicate truth for actions/assignee/storage.

4. **Drop `interop:DataGrant`** ✅
   - Change remaining SPARQL queries and type checks to LWS `AccessGrant`.
   - Remove the extra type and the old `DataGrant`-named types/guards.
   - Add regression coverage for grant generation, chain, revocation closure,
     role-expanded grantee, and reciprocal mirror.
   - Exit: end-state grant model reached; current protocol still works; all
     tests green.

### Phase 2 — protocol sequencing

The current `.sai/grants` POST route is the old `GrantIssuanceHandler` dispatch
(needs/delegation/revocation). Step 0 migrates the data model first; Steps 1–7
then change one protocol/transport concern at a time.

0. **Phase 1 redo — ODRL data-model migration (green-to-green, current
   protocol)**
   - This is a second data-model pass: it supersedes the Phase 1 grant/request
     shape with the frozen Phase 0 contract. Actions and terminology stay.
   - Migrate `GrantData`, builders, frames, SPARQL getters/storage filters,
     policy engine, chain/equivalence/revocation closure, federation mirror,
     registration projections, ACR, admin grants, seeds/fixtures, API/UI read
     models, and tests to the issue-303/ODRL shape: `Request`/`Agreement`,
     `id` + `uid`, `profile`, `permission[]`, permission-level
     `assigner`/`requester`/`assignee`, and target
     `storage`/`type`/`id`/`uid`/`source`.
   - Migrate the needs and delegation request builders and current handlers in
     the same change, so no old-request → new-grant mapping layer is needed.
   - Land the SAI context, the local ODRL context (`uid` → `odrl:uid`), and the
     three-context composition.
   - Keep current endpoints, statuses, and workflow sequencing.
   - Exit: full suite green with the new RDF shape; no protocol/transport
     change yet.

1. **Access request endpoint: needs only**
   - Add `/.sai/access-requests/<owner>` with the custom POST handler and
     registry façade for GET/HEAD.
   - Send the already-migrated needs payload to the new endpoint.
   - Leave delegation/revocation at the old `.sai/grants` POST temporarily.
   - Exit: needs-request tests pass against the new endpoint; old delegation and
     revocation tests still pass.

2. **Move delegation issuance to the access request endpoint**
   - Route the already-migrated top-level delegation array to
     `/.sai/access-requests/<owner>`.
   - Keep current chain validation and synchronous issued-grants response as a
     documented SAI-profile divergence for now.
   - Remove the delegation branch from the old endpoint.
   - Exit: delegation tests pass on the new endpoint.

3. **Move revocation to the access request endpoint**
   - Add `interop:AccessRevocationRequest` with grant IRIs in `interop:grants`.
   - Keep current authority, batch/all-or-nothing, C1 closure, automatic
     behavior, and owner-workflow deletes.
   - Remove the revocation branch from the old endpoint.
   - Exit: revocation tests pass on the access request endpoint; no grant DELETE
     is exposed.

4. **`/.sai/grants` becomes the read-only grant view**
   - Now that no POST traffic remains, make `/.sai/grants/<owner>` GET/HEAD
     only, served by `AccessGrantHandler` over the grant registry.
   - Owner sees all own grants; an agent sees its own grants; no mirrored
     grants; no role expansion.
   - Exit: grant-read tests pass; old issuance route is gone.

5. **Disable `.lws` access stores/readers**
   - Remove `.lws/grants`, `.lws/requests`, `AccessGrantReader/Index`,
     `AccessDocumentOperationHandler`, `.lws` initializer paths, and `.lws` path
     handling from SAI data/registry config.
   - Keep LWS storage description, token exchange, containment, and
     notifications.
   - Replace the CSS `AccessServiceDescriber` with a SAI describer that
     advertises the owner-scoped access request/grant services.
   - Exit: no `.lws` access resources are created or read by SAI; tests green.

6. **CID and discovery**
   - Add service triples to account bootstrap and `registry.trig`.
   - Update `services/id` and `AgentIdHandler` for `application/cid` content
     negotiation.
   - Replace `interop:hasDelegationIssuanceEndpoint` discovery with the access
     request service; add the access grant service.
   - Advertise the owner endpoints in storage descriptions.
   - Exit: requester discovers both endpoints from the owner’s WebID/ClientID
     CID and storage description.

7. **Cleanup**
   - Remove `issuanceUrl`, `hasDelegationIssuanceEndpoint`, old message guards
     and types, old routes, dead config, and dead tests.
   - Update `README.md`, sequence diagrams, and any remaining references to the
     old issuance model; keep `lws/TODO.md` current for remaining work.
   - Exit: no stale references to the old issuance model; docs match the new
     endpoints and wire shapes.

---

## 9. Tests

Completed in Phase 1:

- access-mode mapping / canonical action assertions,
- LWS context/frame round-trips (bundled context + grant frames),
- canonical grant shape, target mapping, and no-legacy-fields assertions,
- grant-chain, equivalence, revocation closure, and admin-grant coverage,
- role/`AllFromRole` concrete-grantee regression,
- reciprocal-mirror and delegation-response type coverage,
- canonical seeds/fixtures and terminology sweep.

Pending for Phase 0:

- SAI profile context/document expansion/framing tests,
- frozen needs/delegation/revocation request examples,
- mapping/divergence docs assertions.

Pending for Phase 2:

- Phase 2 Step 0: ODRL policy/permission expansion and compaction across the
  three contexts; permission-level `assigner`/`requester`/`assignee`; target
  `storage`/`type`/`uid`/`source`; selected scope one permission per resource;
  grant builders/SPARQL/ACR/federation round-trips.
- needs request POST/GET/duplicate/idempotency,
- delegation request POST and grant read,
- revocation request authority/closure/all-or-nothing,
- grant endpoint owner vs grantee vs unregistered vs role-origin grant,
- no mirrored grants,
- WebID/ClientID `application/cid` content negotiation and service entries,
- storage description service entries.

Keep the existing Temporal/workflow tests where grant-generation and
reconciliation semantics are unchanged; update transport expectations only.
