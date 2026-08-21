# Org admin — `AdminAuthorization` + `AdminGrant` (R1; supersedes the flag)

> **Status:** design; seed data **done** (§3.6, revised per R1). Models who is
> an **admin** of the organization owning the Agent Registry as an
> `AdminAuthorization` (+ generated `AdminGrant`s) instead of the original
> `interop:AdminRegistration` rdf:type — see **Revision R1** below. This is the
> **marking** layer only — it records *who* is an admin. Granting admins Write
> on the org's registries (ACP `fullAdminAccess` + permission engine via
> Read-only data-registry grants) is the enforcement half (§6 / R1).

## Revision R1 — `AdminAuthorization` + `AdminGrant` (supersedes the flag)

R1 replaces the `interop:AdminRegistration` rdf:type on the registration with a
grant/authorization pair mirroring the data model. Decisions recorded with the
maintainer (see `events.md` for the event model, `federation.md` for the
single-store assumptions the engine path relies on):

- **Model.** `AdminAuthorization` in the org's AuthorizationRegistry (like
  `DataAuthorization`): `grantee` (the admin webId), `grantedBy` (the org),
  `scopeOfAuthorization interop:All` for now. The org's `SocialAgentRegistration`
  of the admin links `interop:hasAdminGrant` (array) to `AdminGrant`s in the
  org's GrantRegistry. The reciprocal registration stays plain (same asymmetry
  as data grants).
- **AdminGrant scopes** — `scopeOfAdminGrant` is `interop:RegistrySet` or
  `interop:DataRegistry` for now:
  - one **RegistrySet**-scoped grant per admin = the *admin marker* (status /
    discovery / context switcher). For now **only this grant is linked** via
    `hasAdminGrant`; data registries are reached through the RegistrySet
    (`hasDataRegistry`), not by linking every grant;
  - one **DataRegistry**-scoped grant per data registry (storage) in the
    RegistrySet, with `hasStorage` <data registry> and **`accessMode` `acl:Read`
    only** — consumed by `SaiPermissionsEngine` solely to iterate and gather
    labels (e.g. DataRegistry views). Pickup is nearly free: the engine's
    `getAuthorizationData` (`?s <interop:hasStorage> <storage>`) already
    collects them; the engine adds an admin lookup branch for
    Registry/Registration/Resource targets under that storage.
- **Registry storage stays ACP.** `fullAdminAccess` (Read+Write+Control)
  matchers remain the enforcement for structural registries. Matchers become a
  **derived artifact**: rewritten from the admin list by the ACR workflow
  (idempotent rewrite, not incremental patch). The data server's
  `AdminPermissionReader` owner fast-path is unchanged — admins are not owners,
  they fall through to the engine.
- **Pipeline.** `AddAdmin`/`RemoveAdmin` (RPC from the UI) records the
  `AdminAuthorization` and writes a domain activity (`adminAuthorizationRecorded`)
  to the org's Activity Registry; `ActivityWebhookHandler` starts **parallel
  workflows** from the shared trigger — `createAdminGrants` (generate the
  RegistrySet + per-data-registry grants) and `syncAdminAcr` (rewrite
  `#fullAdminAccess`) — diverging after the trigger; the activity payload can be
  adjusted to feed both.
- **No delegation or inheritance** for admin grants — no `delegationOfGrant`, no
  `inheritsFromGrant`, no delegation-endpoint involvement.
- **Admin-authorization iteration is deferred** until the consuming
  functionality is planned. Meanwhile the authorization-registry data iterators
  are **type-filtered** (`interop:DataAuthorization`) so admin resources never
  leak into data flows (the workspace `authorization-agent` package calls the
  same crud functions, so a central filter covers it).
- **Vocabulary.** `interop:` namespace may be modified as needed:
  `AdminAuthorization`, `AdminGrant`, `hasAdminGrant`, `scopeOfAdminGrant`,
  with `interop:RegistrySet` / `interop:DataRegistry` reused as scope values.
- **Seed (§3.6) revised** to the new model (below); `#fullAdminAccess` stays
  hand-written in the seed for now (the matcher workflow supersedes it at
  runtime).
- **TODO (not Phase 1):** a new data registry added to a RegistrySet must expand
  the All-scope authorization into a new DataRegistry grant — future domain
  event (`events.md`).

## Phase map & verification

Three phases, each ending in a **checkpoint**. The repo is turbo-based; the
checkpoint after **every phase and every step** is:

```bash
npm run build && npm run test   # turbo, serial; whole tree must stay green
```

Every step below is a small, **independently mergeable** unit — it must leave
the tree compiling and all existing tests green before moving on. There is no
default-not-green step; if a step cannot land green, it is too big and should be
split.

| Phase | Scope | Steps | Checkpoint
|---|---|---|---|
| **1 — Marking layer** (§3, R1) | vocab · data model · RPC · handler · workflows · seed | 1.1 §3.1 vocab; 1.2 §3.2 data model + iterator type-filter; 1.3 §3.3 RPC service; 1.4 §3.4 API messages; 1.5 §3.5 handler wiring; 1.6 §3.6 seed *(done, revised)*; 1.7 §3.7 admin workflows (grants + ACR) | build+test after each; UI not required yet
| **2 — Operating in context** (§2 below) | context model · discovery · RPC context · backend registry-set map · UI switcher/toggle · e2e | 2.1 `SocialAgent.admin` + discovery; 2.2 `context` field + context struct + context authn; 2.3 registry-set map + `AgentIdHandler` `hasRegistrySet` link; 2.4 service owner/target refactor; 2.5 admin events forwarding (→ Phase 3); 2.6 UI switcher + toggle-admin; 2.7 e2e | build+test after each; e2e scaffolding may be needed before 2.6
| **3 — Admin events forwarding** (§3 below) | reuse `ActivityWebhookHandler` / `AdminWebhookHandler` + shared forwarding module; events keyed to admin webId | 3.1 extract forwarding half; 3.2 subscription recognition + event keying; 3.3 wire admin events into UI | build+test after each
| **4 — Docs update** (below) | `peer.md` · `social-graph.md` | edit both docs to reflect the implemented org-context + forwarding behavior | build+test; review diffs of both docs

Phase 1 (steps 1.1–1.5) needs **no UI**; it is a backend-only vertical slice.
Phase 2 is the largest and is the one most likely to need steps split further
while implementing (each §2.x section maps to roughly one step above).

If a step's tests depend on infrastructure not yet present (e.g. Temporal or a
running CSS for the e2e), note that dependency *inside* the step rather than
carrying an unverifiable step — and flag it in the checkpoint so it is explicit
what is and isn't covered.

Sections 1–6 below are the **Phase 1** working notes (problem, current state,
the change, design decisions, tests, out-of-scope); this and the phase labels
make the numbering concrete: top-level §1–§6 = Phase 1, `## Phase 2 (2.x)` =
Phase 2, `## Phase 3` = Phase 3, `## Phase 4` = Phase 4.

## 1. Problem

Today there is exactly one principal per RegistrySet: the **owner** (`https://id/acme`).
Only the owner holds Write/Control on the org's registries (every registry ACR
and registration ACR in `environments/data/registry.trig` matches
`agent <owner>` + the owner's UAS client). There is **no way to represent** a
second person who should act on the org's behalf.

The plans already assume such people exist but never define them:
`workflow-temporal-decupling.md` repeatedly refers to **"admin agents"** — the
producers who Write the Activity Registry and grant registries — without saying
what makes an agent an admin. The permission engine has explicit holes for it:

- `SaiPermissionsEngine.ts:42` — the `TargetType.Registry` case is an empty
  `break` with `// TODO: use extra data to check if it is an admin using their UAS`.
- `SaiAuthorizationManager.ts:62` — `// TODO: add statements about admins/trusted grants`.

This plan establishes the **data-model + RPC** vocabulary for "this registered
Social Agent is an org admin", so the enforcement phase has something to read.

## 2. Current state (as-is)

- `SocialAgentRegistrationData` has `type: string[]`, captured from framing on
  read (`fromJsonLd` in `packages/data-model/src/crud/social-agent-registration.ts`).
  Today every registration is typed only `interop:SocialAgentRegistration`.
- Writes are centralized: `createSocialAgentRegistration` **hardcodes**
  `quad(node, RDF.terms.type, INTEROP.terms.SocialAgentRegistration)` and
  `addSocialAgentRegistration` seeds `type: [INTEROP.SocialAgentRegistration]`.
- RPC services live in `packages/components/src/services/*` and are dispatched
  from `ApiHandler.ts` via `@effect/rpc` (`RpcRouter.toHandlerNoStream(router)`),
  with request types + the `SaiService` interface + `router` defined in
  `packages/api-messages/src/effect.ts`.
- There is **no** `AdminRegistration` term in the `INTEROP` vocabulary
  (`packages/utils/src/namespaces.ts`).
- Registration CRUD mutation primitives already exist:
  `addStatement`/`removeStatement` (`packages/data-model/src/crud/container.ts`,
  SPARQL PATCH on the registration resource).

## 3. Change

> **Superseded by Revision R1** for the marking model — the flag-based §3.1–§3.5
> below are kept as history. §3.6 reflects R1; §3.7 is new.

### 3.1 Vocabulary

Add `AdminRegistration` to the `INTEROP` vocabulary in
`packages/utils/src/namespaces.ts`.

### 3.2 Data model — `packages/data-model/src/crud/social-agent-registration.ts`

Add three functions. `isAdmin` is a pure read; `addAdmin`/`removeAdmin` mutate
the registration resource and the in-memory `type[]` array. `create`/`add` are
**not** touched — they never produce the admin type.

```ts
/** True when the registration also carries interop:AdminRegistration. */
export function isAdmin(data: SocialAgentRegistrationData): boolean {
  return data.type.includes(INTEROP.AdminRegistration)
}

/** Mark a registered agent as an org admin (idempotent). */
export async function addAdmin(
  data: SocialAgentRegistrationData,
  factory: AuthorizationAgentFactory
): Promise<void> {
  if (isAdmin(data)) return
  const quad = DataFactory.quad(
    DataFactory.namedNode(data.id),
    RDF.terms.type,
    INTEROP.terms.AdminRegistration
  )
  await addStatement(data.id, factory, quad)
  data.type = [...data.type, INTEROP.AdminRegistration]
}

/** Unmark a registered agent as an org admin (idempotent). */
export async function removeAdmin(
  data: SocialAgentRegistrationData,
  factory: AuthorizationAgentFactory
): Promise<void> {
  if (!isAdmin(data)) return
  const quad = DataFactory.quad(
    DataFactory.namedNode(data.id),
    RDF.terms.type,
    INTEROP.terms.AdminRegistration
  )
  await removeStatement(data.id, factory, quad)
  data.type = data.type.filter((t) => t !== INTEROP.AdminRegistration)
}
```

- `addStatement`/`removeStatement` are already imported/exported from
  `./container` (used elsewhere in the same module for `reciprocalRegistration`).
- Export `isAdmin`, `addAdmin`, `removeAdmin` from `packages/data-model/src/crud/index.ts`.

> **Why `type[]`, not a new field?** The rdf:type is already round-tripped by
> framing, and the container link (`interop:hasSocialAgentRegistration`) already
> points at the registration. Admin-ness is therefore just an extra rdf:type on
> the same resource — no new predicate, no new container, no reciprocal changes.
> Generic readers that fetch by IRI (`factory.socialAgentRegistration`) see it
> for free; only callers that care to distinguish admins call `isAdmin`.

### 3.3 RPC service — `packages/components/src/services/Admin.ts`

New service following the `RoleRegistry.ts` pattern. It resolves the
registration by webId (fresh from the wire), mutates it, and returns the
updated `SocialAgent` profile so the UI can reflect the change immediately.

- **Gating.** Only **admins of the org** may call `addAdmin`/`removeAdmin`; a
  non-admin gets an error (the org's Agent Registry is admin-only).
- **`removeAdmin` last-admin guard.** Since an org ends up adminless otherwise,
  `removeAdmin` validates that it is not removing the **last admin** and refuses
  if so (the UI also disables the toggle when only one admin remains).
- **ACR matchers must stay in sync.** `addAdmin`/`removeAdmin` must also add/remove
  the admin **and their authorization agent** in `acp:anyOf` of the org's
  `fullAdminAccess` access control in `environments/data/registry.trig` (currently
  matching `<https://id/dan>` + `acp:client <.../aHR0cHM6Ly9pZC9kYW4>` — see the
  `#fullAdminAccess` policy), so the marking and the enforcement never drift.
  This is the enforcement hook that makes the flag actually grant Write/Control
  (see §6).

```ts
import type { AuthorizationAgent } from '@janeirodigital/interop-authorization-agent'
import { addAdmin, removeAdmin } from '@janeirodigital/interop-data-model'
import { IRI, SocialAgent } from '@janeirodigital/sai-api-messages'
import type * as S from 'effect/Schema'
import { buildSocialAgentProfile } from './AgentRegistry.js'

export const addAdmin = async (
  saiSession: AuthorizationAgent,
  webId: S.Schema.Type<typeof IRI>
): Promise<S.Schema.Type<typeof SocialAgent>> => {
  const registration = await saiSession.findSocialAgentRegistration(webId)
  if (!registration) throw new Error(`Social Agent Registration for ${webId} not found`)
  await addAdmin(registration, saiSession.factory)
  return buildSocialAgentProfile(registration, saiSession)
}

export const removeAdmin = async (
  saiSession: AuthorizationAgent,
  webId: S.Schema.Type<typeof IRI>
): Promise<S.Schema.Type<typeof SocialAgent>> => {
  const registration = await saiSession.findSocialAgentRegistration(webId)
  if (!registration) throw new Error(`Social Agent Registration for ${webId} not found`)
  await removeAdmin(registration, saiSession.factory)
  return buildSocialAgentProfile(registration, saiSession)
}
```

### 3.4 API messages — `packages/api-messages/src/effect.ts`

- Add `AddAdmin` / `RemoveAdmin` `TaggedRequest`s:
  ```ts
  export class AddAdmin extends S.TaggedRequest<AddAdmin>()('AddAdmin', {
    failure: S.Never,
    success: SocialAgent,
    payload: { webId: IRI },
  }) {}
  export class RemoveAdmin extends S.TaggedRequest<RemoveAdmin>()('RemoveAdmin', {
    failure: S.Never,
    success: SocialAgent,
    payload: { webId: IRI },
  }) {}
  ```
- Add both to the `SaiService` interface and to the `router`
  (`Rpc.effect(AddAdmin, ...)` / `Rpc.effect(RemoveAdmin, ...)`).

### 3.5 API handler — `packages/components/src/ApiHandler.ts`

Import `addAdmin`/`removeAdmin` from `./services/Admin.js` and wire them into
the `SaiService.of({...})` alongside the other RPC handlers.

### 3.6 Seed data — `environments/data/registry.trig` ✅ *done* (revised per R1)

Added Dan as an admin of YoYo (IDs generated with `npx @paralleldrive/cuid2 --length 6`):

- **YoYo's Agent Registry** (`https://registry/yoyo/agent/`) lists two social
  agent registrations: the existing `z3k7wm` (Bob) and the admin registration
  `ph8e70` (Dan).
- **Admin registration** `https://registry/yoyo/agent/ph8e70/` — **no**
  `AdminRegistration` type; admin-ness is expressed by links:
  ```turtle
  a interop:SocialAgentRegistration, ldp:Resource;
  interop:registeredAgent <https://id/dan> ;
  interop:reciprocalRegistration <https://registry/dan/agent/zdujx0/> ;
  interop:hasAdminGrant <https://registry/yoyo/grant/aq3m2r/> ;   # RegistrySet-scoped
  skos:prefLabel "Dan" ;
  skos:note "An administrator of Yoyodyne." .
  ```
  plus its `.acr` (YoYo `fullOwnerAccess`, Dan `peerReadAccess`).
- **Reciprocal registration** `https://registry/dan/agent/zdujx0/` (Dan's own
  registry, plain `SocialAgentRegistration`) — unchanged: no admin markers on
  the reciprocal, matching the "admin belongs to the owning registry"
  semantics.
- **New `AdminAuthorization`** in the authorization registry
  (`https://registry/yoyo/authorization/<id>`, in `ldp:contains`):
  ```turtle
  a interop:AdminAuthorization;
  interop:grantee <https://id/dan> ;
  interop:grantedBy <https://id/yoyo> ;
  interop:scopeOfAuthorization interop:All .
  ```
  plus its `.acr` (YoYo `fullOwnerAccess`, Dan `peerReadAccess`).
- **New `AdminGrant`s** in the grant registry (`https://registry/yoyo/grant/`):
  one **RegistrySet**-scoped (linked above via `hasAdminGrant`), plus one
  **DataRegistry**-scoped per YoYo data registry — `yoyo-eu` and `yoyo-na` —
  each with `interop:hasStorage <data registry>`;
  `interop:scopeOfAdminGrant interop:DataRegistry`;
  `interop:accessMode acl:Read`, and its own `.acr` (YoYo `fullOwnerAccess`,
  Dan `peerReadAccess`). The Read-only data grants are the engine's source for
  org-context data-registry iteration/labels (see R1).
- **`registry/yoyo/.acr`** keeps `#fullAdminAccess` (Read+Write+Control) with
  the matcher for `id/dan` + Dan's authorization agent, under both
  `acp:accessControl` and `acp:memberAccessControl`, inherited by all of YoYo's
  sub-registries and their members. Hand-written in the seed; at runtime the
  `syncAdminAcr` workflow derives it from the admin list (§3.7).

### 3.7 Admin workflows (grants + ACR) — new

`AddAdmin`/`RemoveAdmin` (RPC) record the `AdminAuthorization` and write the
`adminAuthorizationRecorded` domain activity (`events.md`).
`ActivityWebhookHandler` starts two **parallel workflows** from that shared
trigger:

1. **`createAdminGrants`** — generate the RegistrySet-scoped AdminGrant (and
   link it on the registration) plus one Read-only DataRegistry-scoped grant
   per data registry found via the RegistrySet (`hasDataRegistry`), each with
   its own ACR;
2. **`syncAdminAcr`** — rewrite `#fullAdminAccess` in the org's `.acr` from the
   current admin list (idempotent; the last-admin guard reads the
   AuthorizationRegistry as the single source of truth).

The activity payload can be adjusted to feed both. No delegation or inheritance
for admin grants.

**TODO (not Phase 1):** on a new data registry added to the RegistrySet, expand
the All-scope authorization into a fresh DataRegistry grant — future domain
event (`events.md`).

### 3.8 Type-filtered authorization iterators (R1)

`AdminAuthorization`s co-exist with `DataAuthorization`s in the
AuthorizationRegistry, but every existing consumer iterates the registry
*unfiltered* — which would misbehave (crash on an unknown scope in
`findAgentsWithAccess`, feed garbage into grant generation, spuriously match
`findAuthorizationsDelegatingFromOwner`).

Fix centrally at the crud level (`crud/authorization-registry.ts`):
`dataAuthorizations` / `getDataAuthorizations` / `findDataAuthorizations` /
`findAuthorizationsDelegatingFromOwner` skip resources whose `type` lacks
`interop:DataAuthorization` (load-then-filter — framing tolerates extra types,
so loading an admin resource is safe and the check is just
`type.includes(INTEROP.DataAuthorization)`). One change covers all consumers:
the workspace `authorization-agent` package (`findAuthorizationsForAgent`,
`findAgentsWithAccess`, `generateDataGrants`) and the Temporal authorizations
`activities` all call these same crud functions.

One extra spot: `authorization-agent/src/authorization.ts` reads existing
authorizations directly for the reuse/equivalence logic in
`recordAccessAuthorization` — filter there too so an `AdminAuthorization` is
never reused as a data authorization.

Admin-side iteration is **deferred** (R1): when needed, a parallel
`adminAuthorizations()` will filter `type.includes(INTEROP.AdminAuthorization)`.

## 4. Design decisions

> **R1 supersedes the flag-based decisions below where they conflict** — see
> Revision R1. Kept for history.

- **Additional (optional) type, not a replacement.** A registration stays
  `interop:SocialAgentRegistration` and *additionally* carries
  `interop:AdminRegistration`. This keeps every existing iterator
  (`socialAgentRegistrations`, `findSocialAgentRegistration`, reciprocal
  handling, `getSocialAgents`) working unchanged — an admin is still just a
  social agent.
- **`create`/`add` never add it.** Admin-ness is a privilege granted
  explicitly, not at creation. `addSocialAgentRegistration`'s `type` stays
  `[INTEROP.SocialAgentRegistration]`; only the `Admin` service mutates it.
  This keeps the two concerns separate and avoids an accident where a new
  registration silently becomes an admin.
- **Why a service, not a field in `addSocialAgent`.** The `Admin` RPC is a
  small, explicit surface (`addAdmin`/`removeAdmin`) that mirrors the
  "grant/revoke a flag" semantics and leaves room to add enforcement
  (permission entry, ACR grants, activity write) inside the service later
  without disturbing the generic add.
- **Idempotent.** Adding/removing an admin for an agent who already is/isn't
  one is a no-op (guarded before the PATCH), so repeated calls are safe.
- **Loading fresh.** `findSocialAgentRegistration` reads from the wire, so
  `data.type` reflects current RDF — we don't trust a possibly-stale POJO.

## 5. Testing

- **Data model** (`packages/data-model/test/crud/social-agent-registration.test.ts`):
  - `isAdmin` is `false` for a freshly created registration, `true` after
    `addAdmin`.
  - `addAdmin` adds only the `AdminRegistration` rdf:type (assert via the
    PATCH/interop-utils test fetch), `removeAdmin` removes exactly that type,
    leaving `SocialAgentRegistration`.
  - Idempotence: `addAdmin` twice → single extra type; `removeAdmin` on a
    non-admin → no-op.
  - `createSocialAgentRegistration`/`addSocialAgentRegistration` **never**
    produce `AdminRegistration` (assert on the written dataset).
- **Service** (`packages/components` test of `services/Admin.ts`):
  - `addAdmin`/`removeAdmin` return the updated `SocialAgent` profile and the
    registration reflects the flag on the next read.
  - Unknown webId → error.
- **API messages**: schema compile (`AddAdmin`/`RemoveAdmin`). An end-to-end
  ApiHandler test (if the harness supports it) can call the RPC and assert the
  resulting `SocialAgent`.

## 6. Out of scope / follow-ups

> **R1 re-shapes part of this section:** admin data-registry access is now a
> Read-only grant for iteration/labels; registry-storage enforcement stays ACP.
> See Revision R1 and §3.7.

- **Enforcement — the actual admin privilege.** This plan only *marks* admins.
  Making an admin able to *do* things splits along two different enforcement
  paths:
  - **Structural registries (agent/auth/grant/role/activity) — ACP.** Access is
    controlled by the org's `.acr` files; granting an admin means the
    `fullAdminAccess` matchers in `environments/data/registry.trig` (§3.3/§3.6),
    aligned with `addAdmin`/`removeAdmin`. **Administrative Write/Control on the
    structural registries is fully covered this way.**
  - **Data registries / data instances — permission engine (open).** These are
    served by the **data service** and gated by the `SaiPermissionsEngine`
    (`TargetType.Registry` TODO at `SaiPermissionsEngine.ts:42`,
    `SaiAuthorizationManager.ts:62`). How admins list/read/share the org's data
    registries and instances is **not yet designed** — including how
    `listDataRegistries` / `listDataInstances` behave in an org context and
    whether `shareResource` needs a data instance (for a label) to work (see
    §2.8).
- **Activity write.** Whether `addAdmin`/`removeAdmin` should append an
  activity (`roleMembershipChanged`-style or a dedicated type) to the Activity
  Registry — not needed until admins drive workflows. *Deferred — revisit when
  admins drive workflows; the service hooks live in §3.3.*
- **Admin of *which* registry — ✅ confirmed: placement is sufficient, no
  explicit link needed.**
  - One RegistrySet per webId/org (derived deterministically via
    `registryId(webId)`); the owner's RegistrySet links to its Agent Registry
    via `hasAgentRegistry`, and the registration is a member of that registry —
    so admin scope is reachable by following `hasAgentRegistry` from the
    RegistrySet; nothing needs to be written on the registration.
  - Admin means admin of **everything** (the whole RegistrySet); no per-registry
    scoping at this time.
  - A single agent may admin multiple orgs; admin-ness is scoped by the org
    **context** (the RegistrySet/Agent Registry being operated on), not by the
    registration itself.
- **Seed lifetime.** The Dan-as-YoYo-admin seed (§3.6) is bootstrap data; the
  runtime `addAdmin`/`removeAdmin` path (Phase 1, §3.1–3.5) is what grants
  admins once implemented, superseding the hand-written seed.

---

## Phase 2 (major) — operating in context

> This is the main refactor the org-admin feature unlocks. The user always acts
> in a **context**; by default their **personal context** (their own webId), or
> an **organization context** the user administers. In an org context the user
> operates on *that org's* registries with the org as the owner.

### 2.1 Model

A **context** is identified by a webId:
- **Personal context** — the signed-in user's own webId (default).
- **Organization (admin) context** — a webId the user administers, i.e. an org
  whose Agent Registry holds an `AdminRegistration` for the user (the user's
  reciprocal registration in that org's registry).

The backend **keeps the user's own AuthorizationAgent** (their UAS as the OIDC
client — this is exactly what `fullAdminAccess` on the org's `.acr` matches) and
redirects which registries it operates on. In an admin context:

- **Owner identity = the org.** Recorded as `dataOwner` and `grantedBy` on
  grants/authorizations, as the ACR `fullOwnerAccess` creator on new
  registrations, and as the `webId` actor in activities. The user (admin) only
  *authenticates*; they are not the data owner. *(C1 — decided)*
- **Target registries = the org's.** Reads and writes hit the org's
  agent/authorization/grant/activity/data registries, not the user's.

Today services derive *both* the target and the owner from `saiSession.webId` +
`saiSession.registrySet` (e.g. `addSocialAgent` → `creator: { agent: saiSession.webId, client: saiSession.agentId }`, `recordAuthorization` → `grantedBy: saiSession.webId`, reads → `saiSession.registrySet`). The core refactor is replacing those two with **context-derived** values.

### 2.2 Context discovery (switchable contexts)

- **`SocialAgent.admin` boolean (moved up from the §6 UI follow-up).** Extend
  the `SocialAgent` message with an **`admin` boolean** and populate it in
  `buildSocialAgentProfile` (from `isAdmin` on the registration, applying the
  asymmetry below) so the UI can flag admins of the context org. *(Q6 — decided)*
- **Asymmetry (where the flag is read from).** The admin marking lives on the
  **org's registration of the user** (the reciprocal). So deciding which side to
  read depends on the context:
  - if `context === user's webId` (personal context): `admin` is read from the
    **reciprocal** registration (`isAdmin(reciprocalRegistration)`);
  - if `context` is an org other than the user: `admin` is read from **that
    org's registration** of the agent directly.
  Check `context === webId` to select which side applies.
- The UI derives the **switcher list** from that personal-context list: personal
  context (own webId) + each agent where `admin === true`. The **label** shown in
  the switcher is the same `label` as the social agent's. *(Q6 — decided)*
- `ListSocialAgents` in the personal context is therefore the discovery call. It
  also lets the UI re-validate that a chosen context is still allowed.

### 2.3 Context on the RPC layer (`packages/api-messages`)

- Add a **required `context` field** (`IRI`) to each request that operates on a
  registry. The client sets it; when the user has not switched context it **defaults
  to the user's own webId**. Services use it to select the target org and owner
  identity.
- **Personal-only requests (no `context`)** — start with: `BootstrapAccount`,
  `CheckHandle`, `GetWebId`, `RegisterPushSubscription`, and the discovery call
  (personal-context `ListSocialAgents` used to compute contexts). *(C3 —
  starting list, refine in next iteration.)*
- `ListSocialAgents` returns `SocialAgent[]` with the new `admin` boolean.

### 2.4 Backend / service refactor (`packages/components/src/services/*`, `ApiHandler`)

- Introduce a **context struct** for services, e.g.
  `{ webId /* owner */, registrySet }`, resolved from the request's `context`.
  **`session.webId` stays unchanged** — the owner identity for writes comes from
  the context, not by mutating the session.
- **Registry sets as a map keyed by webId.** Instead of a single `registrySet`
  on the session, hold a `Map<webId, RegistrySet>`. To stay consistent with the
  current implementation, the **user's own registry set is eager-loaded** into
  the map; every other context's registry set is **lazy-loaded on demand** when
  first used.
  **Sessions are short-lived** (one per request or per temporal activity), so
  this map lives for the lifetime of a single session — there is **no
  cross-request cache to invalidate** when an admin is added/removed; the UI
  refresh (2.5) covers user-visible staleness.
- Replace uses of `saiSession.webId` (as *owner*) and `saiSession.registrySet`
  (as *target*) with context values when outside the personal context; in the
  personal context they collapse back to the user. This also applies to
  peer-scoped services such as `getDataRegistries`/`getAuthorizationData`: they
  take the `context` and use it **instead of `saiSession.webId`**, because the
  read is from the perspective of the **context org**, not the admin user.
- **Context authorization.** Every service method called from `ApiHandler`
  *validates first* that the requested context is allowed for the user — the
  personal context always; an org context only if the user is an admin of it
  (reciprocal registration `isAdmin`) — otherwise respond with an error before
  touching any registry. *(Q1/Q4 — decided)*
- **Registry-set resolution (proposed mechanism — iterate).** The org's registry
  set is currently stored in CSS internal storage and reached through
  CSS-specific handlers; the user's own session reaches it via `registryId(webId)`.
  Proposed concrete mechanism: **add a second `Link` response header to
  `AgentIdHandler`** when the requesting agent is an admin of the org whose
  agent-id document is requested.
  - `AgentIdHandler` already builds the org's session and — for a requesting
    agent who is not the owner — lands in the `findSocialAgentRegistration`
    branch (YoYo's registration of Dan). After that lookup, if `isAdmin(registration)`,
    add `<${sai.registrySet.id}>; rel="${INTEROP.hasRegistrySet}"` alongside the
    existing `registeredAgent` link. Only admins get this second link.
  - Requires a new `hasRegistrySet` rel term in `packages/utils/src/namespaces.ts`
    (the vocab has no predicate pointing at a RegistrySet from an agent doc).
  - The admin client fetches the org's agent-id doc (already reachable via
    authorization-agent discovery), reads the header, and lazy-loads the
    RegistrySet into the webId-keyed map using its own (ACR-authorized) fetch.
  - **Federated nuance:** this is a federated system — the **org's authorization
    agent may live on a different server than the admin's**. The org's AA is the
    one that responds from `AgentIdHandler` (serving the org's agent-id doc /
    registry-set link) and the one that subscribes to the org's Activity Registry
    and runs the required temporal workflows. Our UI interactions mostly go
    through the **admin's** AA; the registry-set link comes from the **org's**
    AA. The header therefore carries the authoritative registry-set IRI across
    servers.
  - This complements context discovery: `listSocialAgents.admin` (which
    contexts) + the header (how to load one).
  This part is expected to change through implementation. *(C2 — iterate)*

### 2.5 UI refactor (`ui/authorization/`)

- Add a **context switcher** to the default layout: "Personal context (my
  webId)" plus one entry per administered org (from `ListSocialAgents.admin` +
  label).
- **`effect.ts` sends the selected `context`** (defaulting to the user's webId) with
  every applicable RPC.
- **All registry-backed views become context-aware** — social agents, roles,
  applications, data registries, authorizations — so switching context re-targets
  them to the org's registries. During implementation, identify which views make
  no sense in an admin context and exclude them. *(Q5 — decided, iterate)*
- **Toggle-admin button (moved up from the §6 UI follow-up).** On each social
  agent in the org's context, a toggle-admin button calls the `AddAdmin`/
  `RemoveAdmin` RPC methods (§3.4) to promote/demote the agent, then refreshes
  the list from the returned `SocialAgent` (and the badge from the new `admin`
  field).
- **Context switcher and the toggle-admin button are separate UI concepts.** The
  **context switcher** changes the current context the whole UI operates in. The
  **toggle-admin button** (on a social agent in the org's context) lets one admin
  add/remove *other* admins. They are **not** mixed or reused: the toggle manages
  the admin flag on another agent; the switcher selects which context the UI is
  currently operating in.
- **Keeping the switcher/admin list fresh (event-driven).** The UI already
  subscribes to activity-registry events. When a reciprocal registration is
  updated (e.g. the org's registration of the user changes its `AdminRegistration`
  flag), `ReciprocalWebhookHandler` writes a `delegatedGrantsUpdated` activity to
  the admin's Activity Registry. After that activity completes, the resulting
  event is **forwarded to the UI**, which re-runs `loadSocialAgents` to recompute
  the switchable contexts and `admin` flags. Combined with short-lived sessions
  (§2.4), this keeps the switcher in sync without a long-lived cache.
  **Dual cause — acceptable for now.** A reciprocal-registration `Update` covers
  both grant changes and admin-flag changes; we deliberately reuse the same
  `delegatedGrantsUpdated` activity for both rather than distinguishing them.
  This is fine for now — the re-run is cheap and idempotent. It may need further
  optimization later (see §2.8) via caching/diffing to know the actual change,
  e.g. so the UI refreshes only the switcher on an admin-flag change instead of a
  full `loadSocialAgents`.

### 2.6 Decisions recorded

- **(C1)** In an admin context the org is `dataOwner`/`grantedBy` and the ACR
  owner; the admin only authenticates.
- **(C2)** Keep the user's AuthorizationAgent; `session.webId` is unchanged and
  owner identity comes from the context. Registry sets are held in a **map keyed
  by webId** — the user's own is eager-loaded, others lazy-loaded on demand.
  Resolution mechanism: a second `Link` header on `AgentIdHandler` exposing the
  org's RegistrySet IRI to admins (needs a `hasRegistrySet` rel). The org's AA may
  be on a **different server** than the admin's — the org's AA serves the
  registry-set link and runs the Activity Registry workflows. — **iterate** on
  this.
- **(C3)** Personal-only RPC starting set: `BootstrapAccount`, `CheckHandle`,
  `GetWebId`, `RegisterPushSubscription`, + discovery — **refine**.
- **Context is required** on applicable requests, defaulting to the user's own
  webId.
- **Toggle-admin and context switcher are separate UI concepts** and are not
  mixed or reused.
- Discovery of switchable contexts via `ListSocialAgents` `admin` bool + reuse
  of the agent's `label`; `admin` is read from the reciprocal in the personal
  context (`context === webId`) and from the org's registration otherwise.
- **`AddAdmin`/`RemoveAdmin` are admin-only**, and `removeAdmin`/the UI refuse
  to remove the last admin.
- **Peer-scoped services use `context`, not `saiSession.webId`**, since reads are
  from the perspective of the context org.
- **Short-lived sessions** (per request / per temporal activity): the webId-keyed
  registry-set map needs no cross-request invalidation.
- **UI freshness is event-driven**: a reciprocal-registration update →
  `ReciprocalWebhookHandler` `delegatedGrantsUpdated` activity → forwarded to the
  UI after completion → re-run `loadSocialAgents` to recompute admin flags and
  switchable contexts.

### 2.7 Testing

- **Context authorization:** a user cannot target a context they don't admin
  (RPC returns an error); the personal context is always allowed.
- **Owner identity:** acting in an org context creates grants/authorizations
  with `dataOwner`/`grantedBy` = the org, and registration ACR `fullOwnerAccess`
  = the org, while the write is authenticated by the admin's UAS (matched by
  `fullAdminAccess`).
- **Discovery/UI:** personal-context `ListSocialAgents` flags admins; the
  switcher offers exactly personal + administered orgs.
- **Admin gating:** `AddAdmin`/`RemoveAdmin` succeed only when the caller is an
  admin of the context org; a non-admin is rejected before any mutation.
- **Last-admin guard:** `removeAdmin` (and the UI toggle) refuse to remove the
  last admin; the org never ends up adminless.
- **Context perspective:** in an org context, `getDataRegistries`/peer reads use
  the context org, not the admin's webId, as the perspective.
- **Event-driven refresh:** when the org updates the user's reciprocal
  registration admin flag, `ReciprocalWebhookHandler` emits a `delegatedGrantsUpdated`
  activity that is forwarded to the UI after completion, re-running
  `loadSocialAgents` and updating the switcher/admin flags.
- **Seed-driven e2e:** Dan logs in, switches to YoYo context, and can operate on
  YoYo's registries (the `ph8e70` + `fullAdminAccess` seed already enables the
  ACR path).

### 2.8 Open items to resolve during implementation

- Exact shape of the `context` field on each request and the context struct
  (required, defaults to user's webId).
- How to resolve a non-user context's registry set (C2): proposed `AgentIdHandler`
  second `Link` header (`<registrySet>; rel="interop:hasRegistrySet"`) for admins;
  needs the `hasRegistrySet` rel term; the org's AA (possibly another server)
  serves it and runs the Activity Registry workflows. Verify against CSS internal
  storage.
- Registry-set link goes in the **response `Link` header, not the body** — the
  header is evaluated against the request credentials (so the admin-only link can
  be gated on `isAdmin`), whereas the agent-id document body is currently public.
- Final list of personal-only RPCs (C3).
- Which views are excluded from admin context (Q5).
- **Admin access to data registries / data instances — open (design needed).**
  In an org context an admin reaches the org's *structural* registries via ACP
  (`fullAdminAccess`), but `listDataRegistries` / `listDataInstances` are served
  by the **data service** and gated by the `SaiPermissionsEngine` — admins
  currently have **no** permission there. We still need to design how an admin
  lists (and reads) the org's data registries/data instances; the
  `TargetType.Registry` TODO in `SaiPermissionsEngine.ts:42` is the hook.
  `shareResource` may also be affected if it needs to read a data instance
  (e.g. to display a label) before it can share — a peer/org-context
  `shareResource` must resolve that instance through the same permission path.
- **Optimization (future):** distinguish the reason a reciprocal registration was
  updated (grant change vs. admin-flag change) instead of reusing
  `delegatedGrantsUpdated` for both — likely requires some **caching and diffing**
  of the registration to know the actual change, so the UI can refresh only what
  is affected (e.g. the switcher, not the whole social-agents list). Accepted as
  a known limitation for now.

---

## Phase 3 — admin events forwarding (WebhookHandler reuse)

Closes the Phase-2 events gap: the admin UI must learn about org-context
activity outcomes. `ActivityWebhookHandler`
(`packages/components/src/ActivityWebhookHandler.ts`) is currently the
**owner's** handler — it looks up the channel, loads the activity, forwards to
the events bus **and** runs the workflow for each `Add`. Admins watching the
org's Activity Registry only need the **forwarding** half; the org's owner
subscription keeps running workflows (per §2.6 C2 the org's AA runs the org's
workflows). The two halves are already cleanly separated in the handler:

- **forwarding (shared):** the block that calls
  `activityEvents.onActivityAdded(channel.webId, ...)` for both `pending` and
  `done` — currently keyed by `channel.webId`;
- **workflow dispatch (owner-only):** the `GRANTEE_ACTIVITY_TYPES` branch and
  the `activityWorkflows` branch after it.

### 3.1 Extract the forwarding half (Option A or B)

- **Option A — reuse `ActivityWebhookHandler`:** when the subscription is from
  an **admin** and not the registry owner, forward only and skip workflow
  dispatch — this requires knowing, in the handler, whether the subscribing
  channel belongs to the org owner or to an admin.
- **Option B — `AdminWebhookHandler` + shared forwarding module:** extract the
  forwarding block above into a shared module and have the admin handler call
  only that (never dispatch workflows).

### 3.2 Admin subscription recognition + event keying

How an admin subscription is stored/recognized (a separate webhook channel, or
the existing one tagged with the admin webId to receive events). Events must be
keyed to the **admin's** webId (`ActivityEvents` is keyed by webId) so the
admin UI receives them — not the org's. Decide whether this replaces the §2.5
reciprocal-observer refresh or supplements it (i.e. the admin UI now gets live
`pending`/`done` for org-context workflows, closing the §2.6 events gap noted
in §2.8).

### 3.3 Wire admin events into the UI

Subscribe the admin UI to the org's Activity Registry events alongside the
existing personal-context stream, and refresh the relevant org-context views on
`pending`/`done`. Depends on the Phase-2 registry-set resolution (`hasRegistrySet`
link, §2.4/§2.8) to reach/authorize the org's Activity Registry from the admin
side.

---

## Phase 4 — update the architecture docs for org context

`peer.md` and `social-graph.md` both encode assumptions the org-context feature
(Phases 1–3) changes. Update them once the implementation has landed, reflecting
the **actual** Phase-3 forwarding approach rather than the options above. Most
of the org-admin behavior is consistent with the docs already; the changes below
reflect only what the feature *breaks* or leaves undefined.

### Already consistent — do not change

- Admin-flag change on the org's registration of the user is a reciprocal
  `Update` → `ReciprocalWebhookHandler` → `delegatedGrantsUpdated`
  (peer.md producer/consumer tables; social-graph §2 polarity). **No new
  activity type** — the producer/consumer tables in peer.md stay as-is except
  for the org-context notes below.
- `AddAdmin`/`RemoveAdmin` are synchronous RPC and write no activity (out of
  scope, §6) — no producer-table row is added.
- The admin marking lives on the org's registration of the user, reachable via
  the `reciprocalRegistration` link from the user's own registration — matches
  the existing reciprocal convention in social-graph §5 and the §3.6 seed
  (`ph8e70` carries the admin type, `zdujx0` does not).

### peer.md — "a single peer" must stop assuming one peer = one registry set

1. **Multi-registry-session org context.** Add a section: in an org context the
   admin (own UAS/AuthAgent) operates on the **org's** registries — owner =
   org (context, per C1), client = the admin's UAS (matched by
   `fullAdminAccess`). `session.webId` and the admin's own registry set are
   unchanged; the org's registry set is lazy-loaded into a webId-keyed map,
   per short-lived session (§2.4/2.6 C2).
2. **Outbox & events ownership in org context (implemented in Phase 3).**
   Layer diagram §1 and EventBus §5 key events by the **admin's** webId
   (`webIdLinks[0]`). Org-context activities land in the **org's** Activity
   Registry and are processed by the **org's** AA/workflows (§2.6 C2), so their
   `pending`/`done` events are keyed by the *org* webId — not the admin's
   stream. Document the Phase-3 solution for how the admin UI learns about
   org-context workflow outcomes (the chosen WebhookHandler Option A/B, the
   admin subscription/event-keying, and whether it supplements or replaces the
   §2.5 `delegatedGrantsUpdated` refresh).
3. Update the layered-diagram actor label: a registered admin is a *client of
   another peer's registries*, not the owner of the registries it mutates (C1).

### social-graph.md — new org↔admin edges

1. **§3 `AgentIdHandler` extension.** Document the new admin-only `Link` response
   header (`<registrySet>; rel="interop:hasRegistrySet"`) on the **org's**
   agent-id doc when the requester is an admin (header-gated via `isAdmin`;
   body stays public), plus the new `hasRegistrySet` rel term. Note the org's
   AA — possibly on a **different server** than the admin's — serves it and
   runs the org's Activity Registry workflows (federated case).
2. **New relationship: org member (admin).** Add the org↔admin pair to the tier
   table / edge inventory: the admin performs Tier-3 reads/writes against the
   org's registries with its own UAS but the **org** as data owner; the org's
   AA is the peer whose handlers (`AgentIdHandler`, Activity Registry
   workflows) serve the org's registries. State explicitly it is federated
   when the two AAs are on different servers.

### Consistency checks to run before closing Phase 4

- Grep both docs for single-registry-set assumptions where the admin now acts
  for the org (owner = org, not the session's webId; one peer may touch multiple
  registry sets) and update each occurrence.
- Update doc tables/edge inventories that enumerate actors, activities, and
  endpoints to reflect org-context operation and the new `AgentIdHandler`
  admin link.
- Confirm the resolved events/outbox story (peer.md item 2) is reflected in
  both documents so they do not silently drift from the implementation.
