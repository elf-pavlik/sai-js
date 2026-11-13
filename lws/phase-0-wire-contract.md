# Phase 0 wire contract

Status: **frozen** — all Phase 0 payloads and the SAI context term list are
agreed. Implementation starts with Phase 2 Step 0.

This is the frozen-contract companion to
[`lws-alignment-plan.md`](./lws-alignment-plan.md) and [`TODO.md`](./TODO.md).
Add payloads here only after they are agreed. Phase 0 does not change protocol
behavior.

## Settled decisions

### Contexts

Every document uses three contexts together:

```json
"@context": [
  "https://www.w3.org/ns/lws/v1",
  "http://www.w3.org/ns/odrl.jsonld",
  "https://www.w3.org/ns/solid/interop-context/v1"
]
```

Each context is bundled locally. The local ODRL context maps `uid` to
`odrl:uid` (not `@id`), so every ODRL policy, permission, and target carries
both `id` (`@id`) and `uid` (`odrl:uid`) with the same value. The SAI context
defines every `interop:` term used on the wire so compaction produces bare keys
(`requester`, `scopeOfGrant`, `inheritsFromGrant`, `accessNeedGroup`,
`AccessProfile`, `AccessNeed`, `AccessRequired`, `SelectedFromRegistry`,
`Inherited`, etc.). `st:` is `http://www.w3.org/ns/shapetrees#`. `storage` is
`lws:storage`, defined at the top level of the bundled LWS context (local
addition; upstream scopes it only inside `AccessRequest`/`AccessGrant`). The
local LWS context also drops the top-level `@protected` flag so the three
contexts compose in one document; nested scoped contexts stay protected.

- SAI profile URI: `interop:AccessProfile`; it is the only profile advertised
  in `conformsTo` for now.
- The `interop:` namespace remains `http://www.w3.org/ns/solid/interop#`.
- The internal `dataModelContext` is reconciled with the wire context after the
  migration; it is not the wire context.
- The LWS context stays bundled with the local fixes (`odrl:assignee` IRI
  coercion, target `value` → `lws:value`, top-level `storage`); upstream fixes
  remain a release gate.

### Request and grant envelope

- Requests type as `lws:AccessRequest` + one SAI subtype:
  - `NeedBasedAccessRequest`
  - `DelegationRequest`
  - `AccessRevocationRequest`
- Grants type as `AccessGrant`.
- `access[]` items are ODRL policies:
  - requests: `Request`
  - grants: `Agreement`
- Each policy has `id` and `uid` (same IRI), `profile`, and `permission[]`.
- Each permission has its own `id` and `uid` (same IRI) and carries:
  - `assigner` = `dataOwner`
  - `requester` = renamed `grantedBy`
  - `assignee` = grantee/requester
  - `action`
  - `target`
- Owner-issued grants use `requester` = `dataOwner` (direct map of the current
  `grantedBy`); this may be reconsidered later.
- Requests and grants do not carry envelope-level `requester`, `dataOwner`, or
  `storage`.
- `scopeOfGrant` stays for now on request policies and grant envelopes;
  removing it is future work.
- Needs requests have no `storage`; it may become optional later when the
  requester knows the storage.
- Delegation uses a top-level array of parent-tree request envelopes. Each
  envelope's `access[]` holds the parent policy plus its child policies.
- Revocation remains `AccessRequest` + `AccessRevocationRequest` with
  `interop:grants` grant IRIs; it is not an ODRL policy envelope.

### Target

`target` is one object, never an array. It carries:

```json
{
  "storage": "<data storage>",
  "type": ["<Asset|AssetCollection>", "<SAI type>"],
  "id": "<target IRI>",
  "uid": "<target IRI>",
  "source": ["<asset/registration/shape-tree/agent IRI>"]
}
```

- `SelectedFromRegistry`: one permission per selected resource; target
  `type: ["Asset"]`, `source: [<instance>]`, `partOf: [<registration>]`.
- `AllFromRegistry`: target `type: ["AssetCollection", "DataRegistration"]`,
  `source: [<registration>]`.
- Policies keep a temporary `registeredShapeTree` extension for feature parity;
  it can be removed once shape-tree lookups are resolved from the target.
- `Inherited`: same target as `AllFromRegistry`, plus
  `inheritsFromGrant` on the policy.
- `AllFromAgent`: target type `SocialAgent`; target source is the agent; no
  `storage`.
- Needs shape tree: target `type: ["AssetCollection", "st:ShapeTree"]`,
  `source: [<shapeTree>]`; no `storage` for now.

### IDs

- Request policies, permissions, and targets use `urn:uuid` IDs.
- The owner discards request URNs and mints HTTPS grant IDs.
- Final grants use one envelope `id` plus HTTPS fragment IDs:
  - policy: `<grant>#policy`
  - permission: `<grant>#permission`
  - target: `<grant>#target`
- Every ODRL node repeats the same IRI as both `id` and `uid`:
  `id` is `@id`; `uid` is `odrl:uid`. This is valid because the local ODRL
  context maps `uid` to `odrl:uid`, not `@id`.
- The LWS grant envelope uses `id` only.

### Media and status

- Endpoints accept `application/lws+json` and
  `application/ld+json; profile="https://www.w3.org/ns/lws/v1"`.
- `application/lws+cid` remains storage-description/CID only.
- Needs POST: `202 Accepted`, empty body, no `Location`.
- Delegation and revocation responses stay `application/json` for now; they are
  not parsed as JSON-LD.

## Frozen: needs request

```json
{
  "@context": [
    "https://www.w3.org/ns/lws/v1",
    "http://www.w3.org/ns/odrl.jsonld",
    "https://www.w3.org/ns/solid/interop-context/v1"
  ],
  "type": ["AccessRequest", "NeedBasedAccessRequest"],
  "access": [
    {
      "type": ["Request", "AccessNeed", "AccessRequired"],
      "id": "urn:uuid:7b2a4d3f-5c6e-4f70-9a1b-2c3d4e5f6a7b",
      "uid": "urn:uuid:7b2a4d3f-5c6e-4f70-9a1b-2c3d4e5f6a7b",
      "profile": "AccessProfile",
      "accessNeedGroup": "urn:uuid:6a1f3c2e-4b5d-4e6f-9a0b-1c2d3e4f5a6b",
      "permission": [
        {
          "id": "urn:uuid:9d4e5f6a-7b8c-4d9e-0f1a-2b3c4d5e6f7a",
          "uid": "urn:uuid:9d4e5f6a-7b8c-4d9e-0f1a-2b3c4d5e6f7a",
          "assigner": "https://id/alice",
          "requester": "https://id/bob",
          "assignee": "https://id/bob",
          "action": ["read", "create", "modify", "delete"],
          "target": {
            "type": ["AssetCollection", "st:ShapeTree"],
            "id": "urn:uuid:1d2e3f4a-5b6c-4d7e-8f90-1a2b3c4d5e6f",
            "uid": "urn:uuid:1d2e3f4a-5b6c-4d7e-8f90-1a2b3c4d5e6f",
            "source": ["https://data/shapetrees/trees/Project"]
          }
        }
      ]
    },
    {
      "type": ["Request", "AccessNeed", "AccessRequired"],
      "id": "urn:uuid:8c3b5e40-6d7f-4f81-9a2b-3c4d5e6f7a8b",
      "uid": "urn:uuid:8c3b5e40-6d7f-4f81-9a2b-3c4d5e6f7a8b",
      "profile": "AccessProfile",
      "accessNeedGroup": "urn:uuid:6a1f3c2e-4b5d-4e6f-9a0b-1c2d3e4f5a6b",
      "inheritsFromNeed": "urn:uuid:7b2a4d3f-5c6e-4f70-9a1b-2c3d4e5f6a7b",
      "permission": [
        {
          "id": "urn:uuid:0e5f6a7b-8c9d-4e0f-1a2b-3c4d5e6f7a8b",
          "uid": "urn:uuid:0e5f6a7b-8c9d-4e0f-1a2b-3c4d5e6f7a8b",
          "assigner": "https://id/alice",
          "requester": "https://id/bob",
          "assignee": "https://id/bob",
          "action": ["read", "create", "modify", "delete"],
          "target": {
            "type": ["AssetCollection", "st:ShapeTree"],
            "id": "urn:uuid:2e3f4a5b-6c7d-4e8f-9a0b-1c2d3e4f5a6b",
            "uid": "urn:uuid:2e3f4a5b-6c7d-4e8f-9a0b-1c2d3e4f5a6b",
            "source": ["https://data/shapetrees/trees/Task"]
          }
        }
      ]
    }
  ]
}
```

## Frozen: delegation request

Top-level array; one item per parent tree.

```json
[
  {
    "@context": [
      "https://www.w3.org/ns/lws/v1",
      "http://www.w3.org/ns/odrl.jsonld",
      "https://www.w3.org/ns/solid/interop-context/v1"
    ],
    "type": ["AccessRequest", "DelegationRequest"],
    "access": [
      {
        "type": ["Request"],
        "id": "urn:uuid:3a1b2c3d-4e5f-4a6b-7c8d-9e0f1a2b3c4d",
        "uid": "urn:uuid:3a1b2c3d-4e5f-4a6b-7c8d-9e0f1a2b3c4d",
        "profile": "AccessProfile",
        "scopeOfGrant": "SelectedFromRegistry",
        "permission": [
          {
            "id": "urn:uuid:4b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e",
            "uid": "urn:uuid:4b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e",
            "assigner": "https://id/acme",
            "requester": "https://id/alice",
            "assignee": "https://data/test-client/public/id",
            "action": ["read"],
            "target": {
              "storage": "https://data/acme-rnd/",
              "type": ["Asset"],
              "id": "urn:uuid:5c3d4e5f-6a7b-4c8d-9e0f-1a2b3c4d5e6f",
              "uid": "urn:uuid:5c3d4e5f-6a7b-4c8d-9e0f-1a2b3c4d5e6f",
              "source": ["https://data/acme-rnd/pbh2yw"]
            }
          }
        ]
      },
      {
        "type": ["Request"],
        "id": "urn:uuid:6d4e5f6a-7b8c-4d9e-0f1a-2b3c4d5e6f7a",
        "uid": "urn:uuid:6d4e5f6a-7b8c-4d9e-0f1a-2b3c4d5e6f7a",
        "profile": "AccessProfile",
        "scopeOfGrant": "Inherited",
        "inheritsFromGrant": "urn:uuid:3a1b2c3d-4e5f-4a6b-7c8d-9e0f1a2b3c4d",
        "permission": [
          {
            "id": "urn:uuid:7e5f6a7b-8c9d-4e0f-1a2b-3c4d5e6f7a8b",
            "uid": "urn:uuid:7e5f6a7b-8c9d-4e0f-1a2b-3c4d5e6f7a8b",
            "assigner": "https://id/acme",
            "requester": "https://id/alice",
            "assignee": "https://data/test-client/public/id",
            "action": ["read"],
            "target": {
              "storage": "https://data/acme-rnd/",
              "type": ["AssetCollection", "DataRegistration"],
              "id": "urn:uuid:8f6a7b8c-9d0e-4f1a-2b3c-4d5e6f7a8b9c",
              "uid": "urn:uuid:8f6a7b8c-9d0e-4f1a-2b3c-4d5e6f7a8b9c",
              "source": ["https://data/acme-rnd/x0md9s"]
            }
          }
        ]
      }
    ]
  }
]
```

## Frozen: final grants

```json
[
  {
    "@context": [
      "https://www.w3.org/ns/lws/v1",
      "http://www.w3.org/ns/odrl.jsonld",
      "https://www.w3.org/ns/solid/interop-context/v1"
    ],
    "id": "https://registry/acme/wwp4j6",
    "type": ["AccessGrant"],
    "scopeOfGrant": "SelectedFromRegistry",
    "access": [
      {
        "type": ["Agreement"],
        "id": "https://registry/acme/wwp4j6#policy",
        "uid": "https://registry/acme/wwp4j6#policy",
        "profile": "AccessProfile",
        "permission": [
          {
            "id": "https://registry/acme/wwp4j6#permission",
            "uid": "https://registry/acme/wwp4j6#permission",
            "assigner": "https://id/acme",
            "requester": "https://id/alice",
            "assignee": "https://data/test-client/public/id",
            "action": ["read"],
            "target": {
              "storage": "https://data/acme-rnd/",
              "type": ["Asset"],
              "id": "https://registry/acme/wwp4j6#target",
              "uid": "https://registry/acme/wwp4j6#target",
              "source": ["https://data/acme-rnd/pbh2yw"]
            }
          }
        ]
      }
    ],
    "hasInheritingGrant": ["https://registry/acme/qwvbcu"]
  },
  {
    "@context": [
      "https://www.w3.org/ns/lws/v1",
      "http://www.w3.org/ns/odrl.jsonld",
      "https://www.w3.org/ns/solid/interop-context/v1"
    ],
    "id": "https://registry/acme/qwvbcu",
    "type": ["AccessGrant"],
    "scopeOfGrant": "Inherited",
    "inheritsFromGrant": "https://registry/acme/wwp4j6",
    "access": [
      {
        "type": ["Agreement"],
        "id": "https://registry/acme/qwvbcu#policy",
        "uid": "https://registry/acme/qwvbcu#policy",
        "profile": "AccessProfile",
        "permission": [
          {
            "id": "https://registry/acme/qwvbcu#permission",
            "uid": "https://registry/acme/qwvbcu#permission",
            "assigner": "https://id/acme",
            "requester": "https://id/alice",
            "assignee": "https://data/test-client/public/id",
            "action": ["read"],
            "target": {
              "storage": "https://data/acme-rnd/",
              "type": ["AssetCollection", "DataRegistration"],
              "id": "https://registry/acme/qwvbcu#target",
              "uid": "https://registry/acme/qwvbcu#target",
              "source": ["https://data/acme-rnd/x0md9s"]
            }
          }
        ]
      }
    ]
  }
]
```

Parent `hasInheritingGrant` is framed from the stored child
`inheritsFromGrant`. Only child → parent is stored.

## Frozen: revocation request

```json
{
  "@context": [
    "https://www.w3.org/ns/lws/v1",
    "http://www.w3.org/ns/odrl.jsonld",
    "https://www.w3.org/ns/solid/interop-context/v1"
  ],
  "type": ["AccessRequest", "AccessRevocationRequest"],
  "grants": ["https://registry/acme/p9m2vr", "https://registry/acme/q7w3xz"]
}
```

Response/errors are unchanged: `200` + the revoked/echoed grant IRIs, or
`{ code, grants, message }` with 400/403/409. Revocation is not an ODRL policy
envelope; it targets grant resources.

## Frozen: admin grant

```json
{
  "@context": [
    "https://www.w3.org/ns/lws/v1",
    "http://www.w3.org/ns/odrl.jsonld",
    "https://www.w3.org/ns/solid/interop-context/v1"
  ],
  "id": "https://registry/yoyo/vbg74v",
  "type": ["AccessGrant", "AdminGrant"],
  "scopeOfAdminGrant": "RegistrySet",
  "access": [
    {
      "id": "https://registry/yoyo/vbg74v#policy",
      "uid": "https://registry/yoyo/vbg74v#policy",
      "type": ["Agreement"],
      "profile": "AccessProfile",
      "permission": [
        {
          "id": "https://registry/yoyo/vbg74v#permission",
          "uid": "https://registry/yoyo/vbg74v#permission",
          "assigner": "https://id/yoyo",
          "requester": "https://id/yoyo",
          "assignee": "https://id/dan",
          "action": ["read"],
          "target": {
            "id": "https://registry/yoyo/vbg74v#target",
            "uid": "https://registry/yoyo/vbg74v#target",
            "storage": "https://registry/yoyo/",
            "type": ["AssetCollection", "Storage"],
            "source": ["https://registry/yoyo/"]
          }
        }
      ]
    }
  ]
}
```

The `DataRegistry` variant uses `scopeOfAdminGrant: "DataRegistry"` and the
data registry IRI for target `storage` / `source`. `hasAdminGrant` on the
registration still links to the grant IRI. Envelope `storage`, `requester`, and
`dataOwner` are gone; the permission carries them.

## SAI context terms (frozen)

Prefixes:

- `interop:` → `http://www.w3.org/ns/solid/interop#`
- `st:` → `http://www.w3.org/ns/shapetrees#`

Terms:

- `requester` → `interop:requester` (`@type: @id`)
- `AccessProfile` → `interop:AccessProfile`
- `NeedBasedAccessRequest` → `interop:NeedBasedAccessRequest`
- `DelegationRequest` → `interop:DelegationRequest`
- `AccessRevocationRequest` → `interop:AccessRevocationRequest`
- `AccessNeed` → `interop:AccessNeed`
- `AccessRequired` → `interop:AccessRequired`
- `AccessOptional` → `interop:AccessOptional`
- `AdminGrant` → `interop:AdminGrant`
- `DataRegistration` → `interop:DataRegistration`
- `SocialAgent` → `interop:SocialAgent`
- `SelectedFromRegistry` → `interop:SelectedFromRegistry`
- `Inherited` → `interop:Inherited`
- `RegistrySet` → `interop:RegistrySet`
- `DataRegistry` → `interop:DataRegistry`
- `scopeOfGrant` → `interop:scopeOfGrant` (`@type: @id`)
- `scopeOfAdminGrant` → `interop:scopeOfAdminGrant` (`@type: @id`)
- `inheritsFromGrant` → `interop:inheritsFromGrant` (`@type: @id`)
- `hasInheritingGrant` → `interop:inheritsFromGrant` reverse (`@type: @id`,
  `@container: @set`)
- `inheritsFromNeed` → `interop:inheritsFromNeed` (`@type: @id`)
- `accessNeedGroup` → `interop:hasAccessNeed` reverse (`@type: @id`)
- `grants` → `interop:grants` (`@type: @id`, `@container: @set`)

`storage`, `AccessGrant`, `AccessRequest`, `AccessPolicy` types, and the LWS
envelope terms come from the LWS context. ODRL terms (`Request`, `Agreement`,
`permission`, `assigner`, `assignee`, `action`, `target`, `source`, `Asset`,
`AssetCollection`, `uid`, `profile`) come from the local ODRL context.

## Mapping from Phase 1

| Phase 1 shape                                                   | Frozen shape                                                |
| --------------------------------------------------------------- | ----------------------------------------------------------- |
| `lws:AccessPolicy` in `access[]`                                | ODRL `Request` / `Agreement` in `access[]`                  |
| envelope `storage`                                              | permission target `storage`                                 |
| envelope `grantedBy`                                            | permission `requester`                                      |
| envelope `dataOwner`                                            | permission `assigner`                                       |
| `access[].assignee`                                             | permission `assignee`                                       |
| `access[].action`                                               | permission `action`                                         |
| `access[].target.{type,value}`                                  | permission `target.{type,source}` plus `storage`/`id`/`uid` |
| `registeredShapeTree`, `hasDataRegistration`, `hasDataInstance` | target `type`/`source`                                      |
| `scopeOfGrant`                                                  | retained on request policy / grant envelope                 |
| `scopeOfAdminGrant`                                             | retained on the admin grant envelope                        |
| `inheritsFromGrant`, `hasInheritingGrant`                       | policy/envelope links; frame reverse                        |

## No open approvals

All Phase 0 payload shapes and context terms are frozen. Deferred/future work:

- optional `storage` on needs requests once the requester knows the storage;
- rethinking `requester = dataOwner` for owner-issued grants;
- removing `scopeOfGrant` later;
- promoting the local LWS/ODRL context fixes upstream.

## Divergences to document

- Requests may omit LWS-required `storage`; needs requests have no storage.
- Delegation requests are a top-level array of parent-tree envelopes.
- `SelectedFromRegistry` uses one permission per resource, with a singular
  `target`; no target array.
- Targets carry LWS `storage` plus ODRL `type`, `id`, `uid`, `source`, and
  (for selected resources) `partOf`.
- Policies keep a temporary `registeredShapeTree` extension for current code
  paths; it is a candidate for removal once targets are sufficient.
- Policies keep a temporary `registeredShapeTree` extension for current code
  paths; it is a candidate for removal once targets are sufficient.
- Permissions carry SAI `requester` in addition to ODRL `assigner`/`assignee`.
- Delegation/revocation responses stay `application/json`; they are not parsed
  as JSON-LD.
- `interop:AccessProfile` is the only advertised profile.
- Needs POST returns `202` with no `Location`.
