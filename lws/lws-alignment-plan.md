# LWS alignment plan

Status: proposed — 2026-11-11

This supersedes the earlier LWS exploration notes, which were removed during
the 2026-11-11 cleanup. This document is the target design and the phased work
plan; [`TODO.md`](./TODO.md) only tracks remaining work outside this plan.

No code changes are included here yet.

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

### Endpoint model

Owner-scoped SAI endpoints, backed by the existing registries:

| Endpoint | Methods | Backing store | Purpose |
|---|---|---|---|
| `/.sai/access-requests/<base64url(owner)>` | `POST` (custom SAI handler), `GET`/`HEAD` container/member facade | `AccessRequestRegistry` | needs requests, delegation requests, revocation requests |
| `/.sai/grants/<base64url(owner)>` | `GET`/`HEAD` only | `GrantRegistry` + registration projection | LWS `AccessGrant` read view |

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

Use the LWS actions as IRIs (compact terms are accepted under the LWS context):

| SAI old value | Canonical new value | Compact |
|---|---|---|
| `acl:Read` | `http://www.w3.org/ns/odrl/2/read` | `read` |
| `acl:Update` | `http://www.w3.org/ns/odrl/2/modify` | `modify` |
| `acl:Create` | `https://www.w3.org/ns/lws#create` | `create` |
| `acl:Delete` | `http://www.w3.org/ns/odrl/2/delete` | `delete` |

There is no `Control` in SAI grants. Keep ACL/ACP terms only for ACR/ACP
metadata; they are a different layer.

The canonical SAI `interop:accessMode` values switch to the four IRIs above.
This is a breaking migration of seeds, fixtures, data model, API messages, UI,
tests, and policy-engine mappings.

### 2.2 LWS context and SAI profile

Use the LWS context from
`https://raw.githubusercontent.com/elf-pavlik/lws-test-suite/refs/heads/n3/lws-v1.context.json`
as the base, bundled locally. Add a SAI profile context for the terms LWS does
not define.

Reuse existing `interop:` terms where they already model the concept:

- `interop:grantee`, `interop:grantedBy`, `interop:dataOwner`
- `interop:registeredShapeTree`
- `interop:hasDataRegistration`, `interop:hasDataInstance`, `interop:hasStorage`
- `interop:scopeOfGrant`, `interop:scopeOfAuthorization`
- `interop:inheritsFromGrant`, `interop:inheritsFromAuthorization`
- `interop:satisfiesAccessRequest`, `interop:satisfiesAccessNeed`
- `interop:hasAccessNeedGroup`, `interop:hasAccessNeed`, `interop:accessNecessity`

Add profile terms only where needed, for example:

- `sai:AccessRevocationRequest`
- `sai:DelegationRequest`
- `sai:ShapeTree` (target matcher type)
- `sai:DataRegistration` (if `lws:Container` is insufficient)
- `sai:AccessProfile` URI advertised in `conformsTo`
- `sai:dataAuthorization` / `sai:dataGrant` provenance links

The exact SAI namespace, profile URI, and term list are frozen in Phase 0.

### 2.3 Access requests

A needs-based request becomes a valid LWS `AccessRequest`:

- `type`: includes `AccessRequest` and the SAI profile type.
- `storage`: the owner’s registry/control storage.
- `inbox`: requester notification endpoint, if available.
- `access`: one or more `AccessPolicy` objects.
- Each need maps to an `AccessPolicy` carrying:
  - `assignee` = requester,
  - `action` = mapped need access modes,
  - `target` = SAI/LWS target selector (shape tree, registration, or instance),
  - SAI need metadata (`accessNecessity`, inheriting need, shape tree).
- The access-need group is retained as a SAI grouping term so required/optional
  and descriptions remain representable.

Delegation requests use the same envelope with a `sai:DelegationRequest` type
and the existing grant payload as SAI extension properties. The first slice
preserves the current validation and synchronous issued-grants response as a
documented SAI-profile divergence; a later phase can switch to `202` +
notification + grant read.

Revocation requests use the same envelope with
`type: AccessRequest, sai:AccessRevocationRequest` and a target object whose
`value` is the array of grant IRIs to revoke:

```json
{
  "type": ["AccessRequest", "sai:AccessRevocationRequest"],
  "storage": "https://alice.registry/",
  "access": [{
    "type": ["AccessPolicy"],
    "assignee": "https://id/bob",
    "target": {
      "type": "sai:AccessGrant",
      "value": ["https://alice.registry/grant-1", "https://alice.registry/grant-2"]
    }
  }]
}
```

Revocation keeps current SAI behavior:

- authorized caller only (owner or grantor UAS; grantee self-revocation remains
  not offered),
- batch/all-or-nothing,
- C1 closure,
- automatic (no human approval in the first slice),
- physical deletes run in the owner Temporal workflow.

### 2.4 Access grants

There is one grant resource. It is an LWS `AccessGrant` document with SAI
extension fields; `interop:DataGrant` is not used as a separate type in the end
state.

```json
{
  "@context": ["https://www.w3.org/ns/lws/v1", "<sai-profile-context>"],
  "id": "<grant IRI>",
  "type": ["AccessGrant"],
  "storage": "<target storage>",
  "access": [{
    "type": ["AccessPolicy"],
    "assignee": "<grantee>",
    "action": ["<odrl:read|odrl:modify|lws:create|odrl:delete>"],
    "target": {
      "type": "<lws:DataResource|lws:Container|lws:StorageResource|sai:ShapeTree>",
      "value": ["<target IRIs>"]
    }
  }],
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
- Do not keep duplicate `interop:accessMode`, `interop:grantee`, or
  `interop:hasStorage` fields in the end state. The internal read model can
  derive convenience fields, but the RDF resource has one truth.

Target mapping:

| SAI scope | LWS target |
|---|---|
| `SelectedFromRegistry` | `lws:DataResource` values from `hasDataInstance` |
| `AllFromRegistry` | `lws:Container` value `hasDataRegistration` |
| `AllFromAgent` | `lws:StorageResource` value `storage` |
| `Inherited` | parent grant target plus `interop:inheritsFromGrant` |

The LWS target types are not recursive in current CSS. This is a documented
divergence until the SAI profile target matcher exists. SAI clients use
`interop:scopeOfGrant`/related fields; standard LWS clients see the closest
target representation.

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

Add a regression test to keep this invariant.

---

## 3. Endpoint contracts

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
  return grants whose `grantee` is the agent and `dataOwner` is the owner.
  Unregistered agents get `403`.
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

- Add ODRL/LWS vocabularies to `packages/utils/src/namespaces.ts`.
- Add the bundled LWS context and SAI profile context to the local JSON-LD
  document loader, and make `application/lws+json` and `application/lws+cid`
  parse as RDF.
- Add LWS access document types/builders/frames under
  `packages/data-model/src/` (or a dedicated `lws/` module).
- Replace the `GrantData` shape with the LWS `AccessGrant` shape (plus SAI
  extensions), or keep `GrantData` only as an internal normalized view derived
  from the LWS resource.
- Change `interop:accessMode` values in:
  - `packages/data-model` (authorization/grant/need models),
  - `packages/authorization-agent` (grant generation, grant chain),
  - `packages/components` (admin grants, share/authorization services, policy
    engine),
  - `environments/data/registry.trig`,
  - tests, API messages, UI fixtures.
- Keep `acl:` only in `acr.ts` / ACP/ACR metadata.
- Preserve current SAI policy-engine behavior:
  - `lws:create` → `Create` + `Append`
  - `odrl:modify` → `Modify`
  - `odrl:read` → `Read`
  - `odrl:delete` → `Delete`
- Document the divergence from LWS semantics (`modify` also grants append in
  CSS; `create` is container-relative). A later alignment can tighten this.
- Keep `grantChain` coverage exact/action-set based; no action hierarchy.

---

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

---

## 8. Phases

This ordering is deliberate: **Phase 1 changes only the data model, predicates,
and actions while keeping the current endpoints, message sequencing, activities,
and Temporal workflows. Phase 2 changes only the protocol/transport, with the
data model frozen.** Every sub-step is intended to land green-to-green.

### Phase 0 — freeze the wire contract

- Define the SAI profile URI, context, terms, and examples for:
  - needs request,
  - delegation request,
  - revocation request,
  - AccessGrant.
- Bundle the LWS context; confirm `application/lws+json` and
  `application/lws+cid` parse as RDF, and that frames round-trip.
- Add mapping tables and a docs/divergences file.
- Add unit tests for action IRI normalization and document shapes.
- Exit: example documents expand/frame stably; no protocol behavior changed.

### Phase 1 — data model, predicates, actions (current protocol)

Keep the current `.sai/grants` POST dispatch, activity types, and workflow
sequencing throughout this phase. Delegation/revocation message payloads will
change because they embed grants and actions, but no endpoint or workflow step
changes.

1. **Actions and vocabularies**
   - Add ODRL/LWS vocabularies and replace ACL access modes in the SAI model,
     seeds, fixtures, tests, API, and UI.
   - Update `SaiPermissionsEngine`, `grant-chain`, and JSON-LD contexts.
   - Keep ACL/ACP terms for ACR/ACP metadata only.
   - Exit: no `acl:` values remain in grant/authorization/need access modes;
     tests green.

2. **Grant resource shape, compatibility step**
   - Write grants as LWS `AccessGrant` RDF resources in the `GrantRegistry`:
     `storage`, `access`, and SAI extension fields.
   - Keep `interop:DataGrant` as an additional type and keep the old reader
     fields temporarily so current SPARQL/readers/workflows still work.
   - Parse `application/lws+json`/`application/lws+cid` as RDF in the local
     loader; store RDF named graphs, not a `.lws/grants` JSON copy.
   - Exit: all existing tests green with LWS-shaped grant resources; current
     protocol unchanged.

3. **Canonical read/write migration**
   - Switch grant generation, SPARQL getters, equality/chain/revocation,
     federation mirror, registration links, ACR generation, and UI/API reads to
     `access[].action`/`assignee`/`target` + SAI extension fields.
   - Remove duplicate `interop:accessMode`, `interop:grantee`, and
     `interop:hasStorage` writes/reads.
   - Keep `interop:DataGrant` only as the query anchor where still needed.
   - Exit: all tests green; no duplicate truth for actions/assignee/storage.

4. **Drop `interop:DataGrant`**
   - Change remaining SPARQL queries and type checks to LWS `AccessGrant`.
   - Remove the extra type and the old `DataGrant`-named types/guards.
   - Add regression coverage for grant generation, chain, revocation closure,
     role-expanded grantee, and reciprocal mirror.
   - Exit: end-state grant model reached; current protocol still works; all
     tests green.

### Phase 2 — protocol sequencing (data model frozen)

Each step below changes one protocol/transport concern. The grant/request RDF
shape and action IRIs stay unchanged.

1. **Access request endpoint: needs only**
   - Add `/.sai/access-requests/<owner>` with the custom POST handler and
     registry façade for GET/HEAD.
   - Convert needs-based requests to LWS `AccessRequest` + SAI profile and send
     them there.
   - Leave delegation/revocation at the old `.sai/grants` POST temporarily.
   - Exit: needs-request tests pass against the new endpoint; old delegation and
     revocation tests still pass.

2. **Move delegation issuance to the access request endpoint**
   - Convert the delegation request transport to LWS `AccessRequest` +
     `sai:DelegationRequest`.
   - Keep current chain validation and synchronous issued-grants response as a
     documented SAI-profile divergence for now.
   - Remove the delegation branch from the old endpoint.
   - Exit: delegation tests pass on the new endpoint.

3. **Move revocation to the access request endpoint**
   - Add `sai:AccessRevocationRequest` with grant IRIs in `target.value`.
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
     old issuance model; keep `lws/TODO.md` limited to non-plan work.
   - Exit: no stale references to the old issuance model; docs match the new
     endpoints and wire shapes.

---

## 9. Tests

Add or rewrite:

- access-mode mapping unit tests,
- LWS context/frame round-trips,
- needs request POST/GET/duplicate/idempotency,
- delegation request POST and grant read,
- revocation request authority/closure/all-or-nothing,
- grant endpoint owner vs grantee vs unregistered vs role-origin grant,
- no mirrored grants,
- WebID/ClientID `application/cid` content negotiation and service entries,
- storage description service entries,
- regression: role authorizations materialize concrete grantee grants.

Keep the existing Temporal/workflow tests where the grant-generation and
reconciliation semantics are unchanged; update the grant resource shape and
transport expectations in the data-model/protocol phases respectively.
