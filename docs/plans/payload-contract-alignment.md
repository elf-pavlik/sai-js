# Payload contract alignment — `data-model` POJOs ⇄ activities ⇄ RPC messages

> **Status:** design (extracted from `activity-first-services.md` §6.10 / step 0 —
> the **prerequisite** that plan executes against). Aligns the currently
> ad-hoc definitions (POJOs / RPC messages / activities / refs) into one
> hierarchy anchored in `data-model`.
> Adopts three decided changes to the Activity Registry model:
> 1. `ActivityData` becomes a **discriminated union on `type`** — activities
>    are RDF *classes* (capitalized, e.g. `interop:InvitationAccepted`), the
>    `interop:activityType` string predicate is retired;
> 2. **flat interfaces** — no nested `payload` blob; each activity type is an
>    interface named after the class, fields inline (**plain IRIs/literals on
>    the wire**);
> 3. **storage law** — no `{ id, type }` ref objects are stored in any
>    SPARQL-queried registry: refs stay TS-level (implementation-internal),
>    links on the wire are plain IRIs, exactly like every other registry
>    resource today.
> Plus: the `actor` (`as:actor`) field, the `iri` → `id` naming rename, and
> the RPC **`Message`/`Procedure`** naming rule for collisions.
>
> Run **before** `activity-first-services.md` (its step 1 needs the
> `InvitationCreated` activity type; its §6.10 `webId` migration + `activityId`
> rename depend on step 3).

## 1. Problem — four ad-hoc definitions, no single source

The same domain facts are typed in four places, by convention only:

1. **`data-model` POJOs** (`packages/data-model/src/*`) — RDF-projected entity
   records produced by JSON-LD framing (`SocialAgentRegistrationData`,
   `GrantData`, `DataAuthorizationData`, `RoleData`,
   `SocialAgentInvitationData`, `AdminAuthorizationData`, `RegistrySetData`…),
   plus typed-id refs (`SocialAgentId = { id, type }`, `ApplicationId`,
   `AgentId = SocialAgentId | ApplicationId`, `RoleId`, `GrantId`…). Plain TS,
   effect-free.
2. **`api-messages` RPC messages** (`effect.ts`) — UI projections with effect
   Schemas (branded `IRI`, computed fields like `SocialAgent.admin`), no RDF
   `type` arrays.
3. **Activities** (the outbox → workflow inputs) — `ActivityData` is
   `{ id, activityType: string, target: string, payload: unknown,
   createdAt }` (`activity-registry.ts`): the discriminator is a
   `interop:activityType` **predicate value**, the payload is a
   `JSON.stringify`'d **blob** (`interop:payload`) that SPARQL cannot query,
   and `target` is a bare IRI. Producers write **inline untyped literals**;
   `temporal/activities/*` **hand-duplicates input interfaces**
   (`AcceptInvitationInput`, `AdminChangeInput`, `CreateGrantsInput`,
   `ProcessGrantsRevocationInput`…).
4. **The ref-object pattern** (`XId = { id, type }`, e.g. `SocialAgentId` at
   `social-agent-registration.ts:31`) is already the `data-model` convention
   for actors and records, but activities apply it only partially: actors are
   `{ id, type }` refs *inside* payloads, records travel as plain strings
   (`registrationId`, `dataOwner`, `grants`…), and `webId` itself is already
   inconsistent — bare string on `invitationAccepted` /
   `agentRegistrationAdded`, `{id, type}` refs elsewhere
   (`reciprocal.ts` does `getSession(payload.webId)`; `grants.ts`/`admin.ts`
   do `getSession(payload.webId.id)`).

`ActivityWebhookHandler` bridges 3→workflow with `{ ...(activity.payload as
object), activityId }` and `as [ReciprocalRegistrationInput]` casts — the
contract is untyped, and a malformed activity is only caught (if at all)
inside a workflow.

**Dependency direction (decides the anchor):**
`interop-utils` ← `data-model` ← `authorization-agent` ← {`api-messages`,
`components`}. `api-messages` may type-import `data-model`; `data-model` is
effect-free and must not import `api-messages`. ⇒ the canonical shapes live in
`data-model`; `api-messages` holds Schema *projections*.

## 2. Change — hierarchy anchored in `data-model`

### Design decisions (decided)

- **`type`, not `activityType`** — `ActivityData` is a discriminated union on
  `type`; each activity is an RDF class (`type: ['Activity',
  'InvitationAccepted']`, capitalized). Activities become SPARQL-queryable
  (`?s a interop:InvitationAccepted`). The `interop:activityType` predicate is
  retired from the wire; `INTEROP` vocab is extended with the class terms
  (free to add — per decision).
- **Flat interfaces, no `payload`** — one interface per activity class, named
  after it (data-model `InvitationAccepted`, `AgentRegistrationAdded`, …);
  fields inline. Each field maps to a predicate in `dataModelContext` —
  reusing domain terms where they exist (`hasCapabilityUrl`, `hasMember`,
  `hasDataGrant`, `hasSocialAgentRegistration`, …); `interop:payload`
  retired. Enrichment vs context-growth trade taken in favor of queryable
  RDF.
- **`actor` = `as:actor` (decided).** The activity's owner field is named
  `actor` (ActivityStreams) and maps to `as:actor` — verified the generic
  `webId` predicate is used **nowhere else** (no `WebId` term in
  `namespaces.ts`, no `webId` in `dataModelContext`, zero `interop:webId` in
  the seed; every other webId rides a domain predicate: `registeredAgent`,
  `grantee`, `grantedBy`, `dataOwner`, `hasMember`, …). The context gains an
  `as:` vocabulary (`ACTIVITYSTREAMS` in `utils/namespaces.ts`, single-source
  convention). On the wire `actor` is a **plain IRI** (storage law); internal consumers
  wrap it to `SocialAgentId` where routing needs a ref — this resolves the
  old bare-string-vs-`{id,type}` `webId` inconsistency by collapsing to
  plain-IRI storage + TS refs.
- **Storage law — refs stay internal; the wire links by plain IRI
  (decided).** No `{ id, type }` ref object is stored in any registry queried
  with SPARQL — verified against the code that this is already the norm:
  stored registry resources (agent/authorization/grant/role/invitation/data
  registries) link by **plain IRI objects** (no `*Data` POJO field is
  ref-typed; cross-links are `string` IRIs; the `XId` shapes are framing
  projections of a resource's *own* identity + TS-level reference types;
  typed nodes exist only in ACP `.acr` docs, in-memory composites, and the
  *opaque* JSON-string `interop:payload`). Activities — whose **own**
  `type` classes are stored as the activity node's `rdf:type`, like any other
  resource — therefore serialize their fields as **plain IRIs/literals**;
  refs exist only in temporal inputs and payload builders. Consequences:
  (a) `target` stays a **plain IRI** (the completed activity IRI — idea 1's
  `ActivityRef` is dropped; the completed activity's type is found by reading
  the target, not from the completion); (b) the field kind is implied by the
  field name for single-kind fields; the one genuinely multi-kind field
  (`authorizationGrantee`) resolves its kind in the store (`getGrantees`
  already routes by SPARQL) — the UI `done`-mapping no longer reads
  `payload.authorizationGrantee.type`; it refreshes both lists (cheap,
  idempotent) or the service SPARQLs the linked node.
  **Mechanism (JSON-LD framing, json-ld11-framing):** internally the
  JSON/POJO layer may embed a referenced node's types (framing produces
  `{ id, type }` wherever the input dataset — e.g. the shared store —
  contains the linked node); the **writer frames it out before persisting** —
  refs serialize as plain `{ '@id': … }` links via expanded JSON-LD (PUT) or
  single-IRI-object SPARQL-UPDATE (PATCH, already plain) — so no embedded
  node types ever reach the store (CSS would otherwise write the linked
  node's `rdf:type` into the activity's graph — a foreign type claim /
  graph pollution).
- **`target` is a plain IRI** — the changed record/container IRI, or (for
  `activityCompleted`) the completed activity IRI (storage law — no ref
  object; the completed activity's type is read from the target resource).
- **RPC naming rule — `Message`/`Procedure`.** An RPC message/response Schema
  whose name equals an activity class gets the `Message` suffix; an RPC
  request class that would ever collide gets `Procedure`. Today only the
  accept ack: `InvitationAccepted` → **`InvitationAcceptedMessage`**; future
  `InvitationCreated` RPC response → **`InvitationCreatedMessage`**. Request
  classes (`AcceptInvitation`, `CreateInvitation`, `AuthorizeApp`,
  `ShareResource`…) are unaffected — no collisions.
- **Naming — the `iri` → `id` rename.** IRI-valued fields and params are
  named `id` (on ref objects) or suffixed `Id` (`applicationId`,
  `activityId`), **never `iri`**; `webId` stays (domain term for a person/org
  identity).
- **Branded `IRI` stays in RPC messages** (single-kind ids: `context`,
  `webId`, `SocialAgent.id`, …) — the message shape already carries the kind.
  Refs need **no schema-side actor type**: they stay `data-model` `XId` forms
  for temporal inputs/builders (implementation-internal); no `ActorRef` in
  `api-messages` (step 2).

### Step 1 — vocab + context + activity class types in `data-model`

Add to `INTEROP` (`packages/utils/src/namespaces.ts`) and `dataModelContext`
(`data-model/src/context.ts`):
- **class terms**: `InvitationAccepted`, `InvitationCreated`,
  `AgentRegistrationAdded`, `AdminAuthorizationRecorded`,
  `AdminAuthorizationRevoked`, `AuthorizationRecorded`,
  `AuthorizationRevoked`, `RoleMembershipChanged`, `RoleDeleted`,
  `DelegatedGrantsUpdated`, `GrantsRevoked`, `AuthorizationRequested`,
  `ShareRequested`, `ActivityCompleted`;
- **field predicate terms** not covered by existing domain vocabulary (the
  rest reuse `hasCapabilityUrl`, `hasMember`, `hasDataGrant`,
  `hasSocialAgentRegistration`, …): the `as:actor` term (new `ACTIVITYSTREAMS`
  vocab in `utils/namespaces.ts`).

New module `packages/data-model/src/activities.ts` (exported from the
package index; `activity-registry.ts` re-exports `ActivityData`):

```ts
type ActivityBase = {
  id: string
  /** plain IRI — the changed record/container, or (for ActivityCompleted)
   *  the completed activity IRI — storage law: no ref objects on the wire */
  target: string
  createdAt: string
}

export type InvitationAccepted = ActivityBase & {
  type: ['Activity', 'InvitationAccepted']
  actor: string               // as:actor — plain IRI (the registry owner)
  capabilityUrl: string       // interop:hasCapabilityUrl — opaque, stays a plain string
  label: string               // skos:prefLabel
  note?: string               // skos:note
}
// … one interface per class (inventory below); the union:
// fields are plain IRIs on the wire (like every *Data POJO — registeredAgent:
// string); `XId` refs appear only in temporal inputs / payload builders.
export type ActivityData =
  | InvitationAccepted
  | InvitationCreated
  | AgentRegistrationAdded
  | AdminAuthorizationRecorded
  | AdminAuthorizationRevoked
  | AuthorizationRecorded
  | AuthorizationRevoked
  | RoleMembershipChanged
  | RoleDeleted
  | DelegatedGrantsUpdated
  | GrantsRevoked
  | AuthorizationRequested     // future (activity-first step 2)
  | ShareRequested             // future (activity-first step 3)
  | ActivityCompleted
```

**Step-1 green:** strictly additive — vocab terms, context entries, new types;
`ActivityData` is not yet switched (old `{ activityType, payload }` shape
stays until step 3). Checkpoint: build + package vitest green.

### Step 2 — Schema projections in `api-messages` + RPC renames

- `effect.ts` gains the activity Schema projections (same flat field sets,
  **unbranded** — every IRI field is plain `S.String`; no refs needed on the
  wire, so **no `ActorRef`** — refs stay `data-model` `XId` types for temporal
  inputs). The branded `IRI` remains confined to
  UI-facing RPC messages.
- **Apply the `Message`/`Procedure` rule**: rename `InvitationAccepted` →
  `InvitationAcceptedMessage` (accept ack); compiler-checked across
  `effect.ts`, `services/SocialAgentRegistry.ts`, `ui/authorization`
  consumers.
- **No producer change in step 2** — the new shapes are compile-ready but
  unused until step 3 (the old `{ activityType, payload }` producers stay).

Checkpoint: build + package vitest green (rename + additive-schema churn
only).

### Step 3 — THE FLIP — activities become typed classes

The single wire-format change, all together (producers can't half-migrate):
- **Producers** (`acceptInvitation`, `InvitationHandler`, `Admin.ts`,
  `Authorization.ts`, `ShareResource.ts`, `RoleRegistry.ts`,
  `ReciprocalWebhookHandler`, future step-1 `createInvitation`) emit the new
  shape everywhere: `type: ['Activity', '<Class>']`, **flat plain-IRI fields**
  (`webId` → `actor`; `registrationId` → `registration`; `grants` → IRI list;
  no `{ id, type }` objects), **no `activityType`, no `payload`**.
  `XId` refs (`actor: SocialAgentId`, `GrantId[]`, …) appear only in the
  temporal inputs the handler builds from the plain-IRI activity.
- **Readers**: `ActivityRegistry.createActivity`/`loadActivity`/
  `createCompletion` write/read the new shape; `createCompletion` emits
  `type: ['Activity', 'ActivityCompleted']` with `target: <completed activity
  IRI>` (plain IRI; its `completedIri` param → `completedId`).
- **Read path pinned (decided):** `loadActivity` and the per-activity reads
  feeding the handler, pending filters, events forwarding and reconcile
  frame over the **single fetched document only** (current
  `fetchJsonLd(id)` + `frameDoc(doc, …)`) — references come back as plain
  IRIs, matching the declared `string` interfaces. Do **not** route activity
  reads through the store-wide SPARQL endpoint: a dataset-wide frame would
  embed linked nodes' types and make the same field return bare-or-ref
  nondeterministically. Fallback if a future reader must frame a larger
  dataset: `@embed: '@never'` in the frame keeps plain-IRI links.
  Multi-graph read-embedding is deferred (§5).
- **`ActivityWebhookHandler`** dispatches on the `type` discriminant
  (`activity.type.includes('InvitationAccepted')`) and decodes with
  `S.decodeUnknownSync(<class Schema>)(activity)` instead of `as object`
  casts — malformed activities fail fast (also protecting
  `reconcileActivities`). Runtime decode only in handler/activities (Node);
  workflows keep type-only imports (Temporal sandbox).
- **`iri` → `id` rename** lands here, compiler-checked: `queries/org.ts`
  params, `peerProxy`/`peerFetch` `targetIri` → `targetId`, service params
  like `getResource(ctx, iri)` → `id`, temporal `activityIri` →
  `activityId` everywhere (handler dispatch, activity inputs,
  `markActivitiesDone`).
- **Consumers change mechanically**: `reciprocal.ts`
  `getSession(payload.actor)`; `grants.ts` `payload.dataOwner` (plain IRI,
  no deref); pending filters and `getCompletedActivityIris` use
  `activity.target` directly (plain IRI — no `.id`); UI `events.ts`
  `registryOwner()` → `payload.actor`, `done`-mapping on the type discriminant
  (no `authorizationGrantee.type` read — refresh both lists or SPARQL the
  linked node).
- **Docs/tests**: c4 JSON examples (`invitation`, `admin-invitation-send`,
  `admin-invitation-receive`), `events.md` catalogue rows, and `/test`
  invitation + org-context suites **updated within this step** to the new
  wire shape.

**Behavioral delta:** activity wire shape (classes + flat plain-IRI fields +
plain `target`), `interop:activityType`/`interop:payload` retired, stricter
handler validation. Checkpoint: build + package vitest green, **plus `/test`**
suites updated in-step and green.

### Step 4 — (optional hardening) RPC messages derived from POJOs

For the near-identical pairs — `Role`/`RoleData`,
`SocialAgentInvitation`/`SocialAgentInvitationData`,
`RecordedDataAuthorization`/`DataAuthorizationData` — derive the message
schema/type from the POJO (`Pick`/field-map, `prefLabel` → `label`) so a POJO
field change fails the message build at compile time. The `X.make()` mappers
in services stay the translation seam. **Not renaming data-model fields** —
framing is RDF-faithful (`prefLabel` etc.). Decide in review; orthogonal to
steps 1–3.

## Activity inventory (step-1 target — one interface per class)

**The table shows the stored (wire) form — plain IRIs/literals** (`string`),
exactly like every other stored `*Data` POJO (`registeredAgent: string`); the
storage law forbids `{ id, type }` ref objects in SPARQL-queried registries.
Refs (`XId`) appear only in temporal inputs / payload builders; **writers
frame refs out down to plain `@id` links before PUT/PATCH** (mechanism in
Design decisions). Read nuance: framing may embed a referenced node's types
wherever the input dataset contains the node — activity reads fetch single
docs / `GRAPH <iri>` and return plain IRIs; only cross-graph/SPARQL-dataset
reads could re-embed, and that stays internal.
`SocialAgentRegistrationId = AgentRegistrationId`.

| Class (`type[1]`) | Flat interface fields (data-model, `activities.ts` — wire truth) | producer | consumer (workflow / input) |
|---|---|---|---|
| `InvitationAccepted` | `actor: string; capabilityUrl: string†; label: string; note?: string` | `acceptInvitation` (SocialAgentRegistry.ts) | `acceptInvitation` / `AcceptInvitationInput` |
| `InvitationCreated` *(new — activity-first step 1)* | `actor: string; invitation: string; label: string; note?: string` | `createInvitation` RPC | `createInvitation` workflow (new) |
| `AgentRegistrationAdded` | `actor: string; peerId: string; registration: string` | `InvitationHandler` | `establishReciprocal` / `ReciprocalRegistrationInput` |
| `AdminAuthorizationRecorded` / `AdminAuthorizationRevoked` | `actor: string; admin: string*` | `Admin.ts` `addAdmin`/`removeAdmin` | `processAdminChange` / `AdminChangeInput` |
| `AuthorizationRecorded` / `AuthorizationRevoked` | `actor: string; authorizationGrantee: string` (kind resolved in the store — `getGrantees`) | `Authorization.ts` `recordAuthorization`, `ShareResource.ts` `shareResource` | per-grantee consumer / `CreateGrantsInput` |
| `RoleMembershipChanged` / `RoleDeleted` | `actor: string; roleId: string; peers: string[]` | `RoleRegistry.ts` `updateRole`/`deleteRole` | `processRoleMembershipChange` / `processRoleDeletion` / `ProcessRoleMembershipChangeInput` |
| `DelegatedGrantsUpdated` | `actor: string; peerId: string` | `ReciprocalWebhookHandler` | `updateDelegatedGrants` / `FindAffectedAuthorizationsInput` |
| `GrantsRevoked` | `actor: string; grantee: string; dataOwner: string; grants: string[]` | `Revocation.ts` `revokeGrants` *(producer lands in activity-first step 6)* | `processGrantsRevocation` / `ProcessGrantsRevocationInput` |
| `ActivityCompleted` | **no own fields** — `target: string` (plain IRI — the completed activity IRI; its type is found by reading the target, not embedded in the completion) | `markActivitiesDone` / `ActivityRegistry.createCompletion` | forwarding only |
| `AuthorizationRequested` *(new — activity-first step 2)* | `actor: string; authorization: AuthorizationStructure‡` | `authorizeApp` RPC | `processAuthorizationRecorded` (new) |
| `ShareRequested` *(new — activity-first step 3)* | `actor: string; authorization: ShareDataInstanceStructure‡; applicationId: string` | `shareResource` RPC | `processShareRequested` (new) |

† `capabilityUrl` is deliberately the one protocol-opaque plain string
(`federation.md`) — the acceptor must not parse it and never learns the
invitation id, so no ref object is possible. `label`/`note` are literals.

* `admin` is a SocialAgent in today's domain (org-admin-feature §3.6 seed);
plain IRI on the wire; the temporal input wraps it (`AdminChangeInput.admin`
→ `AgentId`) — widen only if app admins ever exist.

‡ **Decided — (a2): move the structures verbatim into `data-model`; refs stay
internal.** `AuthorizationStructure`/`DataAuthorizationStructure` live in
`authorization-agent/src/authorization.ts`, `ShareDataInstanceStructure` in
`authorization-agent/src/authorization-agent.ts` — all *above* `data-model`.
(a2) relocates them verbatim (fields stay domain-shaped `string` IRIs) to
`packages/data-model/src/authorization-structures.ts`; authorization-agent
re-exports them (source-compatible; internal consumers unchanged — no `.id`
derefs). When `AuthorizationRequested`/`ShareRequested` embed them, the
serialized structure contains plain IRIs only — no `{ id, type }` refs,
satisfying the storage law (this was the reason the earlier "ref-ify the
reference fields" (a1) is rejected: it would reify internal refs into a
SPARQL-queried registry). Ref-ification of structure fields can happen in TS
later if a consumer needs it; never on the wire.

**Adding a new activity class (the compile-time rule):** its interface goes
into the `ActivityData` union in `data-model` (plus vocab term + context
entry) — a producer can then only emit a typed activity; the handler,
`reconcileActivities` and `events.ts` each add their row to stay exhaustive.

## 3. What this unblocks

`activity-first-services.md`: its step 1 (`createInvitation` → activity-first)
needs the `InvitationCreated` class + the `webId` unification; its §6.10
payload contract becomes a pointer to this plan; its step 0 keeps only the UI
indicator half; every move there (steps 2–3) adds its activity class here
first.

## 4. Testing

- **vitest** (`packages/*/test`): activity Schema decode cases at the handler
  boundary (valid passes, malformed fails fast); `reciprocal.ts` webId/ref
  migration compiles; `Message`-suffix renames compile across
  `effect.ts`/services/UI; `loadActivity`/`createCompletion` round-trip the
  new shape; step-4 derived-message compile checks if chosen.
- **`/test` (user-run, dagger)**: invitation + org-context suites updated
  in step 3 to the new wire shape (typed classes, plain-IRI links) and
  green; all other suites behaviorally unchanged.
- **Green conditions:** every step ends green **by itself** — build + package
  vitest after steps 1–2 (additive; no on-the-wire change); after step 3 the
  `/test` suites are updated in-step and green (the single wire flip); step 4
  (if done) is build-green only.

## 5. Out of scope

- Moving `effect` into `data-model` (kept effect-free).
- Merging the interface categories into one type (they are different
  projections: framing records / UI messages / activity records).
- Renaming RDF-faithful POJO fields (`prefLabel`…) to UI names.
- **Multi-graph read-embedding — deferred (explored, not adopted).** Returning
  `{ id, type }` refs from `loadActivity` by framing/querying across named
  graphs (each resource in its own `GRAPH <iri>`, name == resource IRI) is
  viable and plane-consistent, but adds per-read cross-graph queries and
  yields only best-effort `type` (agent identities — `actor`/`peerId`/
  `grantee` — lack `rdf:type` in their own graphs today, incl. remote peers)
  and nondeterministic read shapes if the dataset differs per caller. The
  pinned single-doc read (step 3) keeps this plan's surface small; revisit
  the idea on its own if read plane consistency demands it.
- Keeping `interop:activityType` / `interop:payload` on the wire (retired by
  step 3; note the deviation from the spec vocabulary — this registry is
  internal, extended freely).
- Any RPC/response-shape change of `activity-first-services.md`.