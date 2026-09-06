# Payload contract alignment — `data-model` POJOs ⇄ activities ⇄ RPC messages

> **Status: EXECUTED — steps 1–3 landed (amended wire), `/test` suite green (150/150).**
> The plan below remains the authoritative design record; the **Execution notes**
> section at the end records what was implemented (and where it deviates from
> the step sketches/inventory). What remains: step 4 (optional POJO-derived
> message hardening — build-green only, decide in review) and the per-class
> carriers re-pinned by later `activity-first-services.md` steps (the
> invitation legs — the step-1 send leg and both accept/inviter legs — are
> aligned, see Execution notes).
>
> Extracted from `activity-first-services.md` §6.10 / step 0 — the
> **prerequisite** that plan executes against. Aligns the currently
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
- **Object embedding for activity objects (amendment — decided on the
  invitation example, see Inventory).** A class's primary object may ride as
  `as:object` (ActivityStreams) instead of flat fields, in one of **three**
  forms:
  - **live link** — the object's id is fixed at write time and the resource
    EXISTS (so it can be dereferenced later): the wire carries
    `as:object <object-iri>` as a single triple (storage law — no ref
    object, no embedded types); readers that need the POJO embed it via
    `@embed: '@always'` on the `object` frame entry, GRAPH-unioning the
    object's named graph (§5 re-scoped to the `object` field only).
  - **real-id embedded projection (the InvitationCreated form — landed,
    see inventory)** — the object's id is pre-minted at write time
    (`iriForContained`) and the WORKFLOW materializes the resource later, so
    dereferencing at dispatch would 404; the fields the workflow needs are
    known at write. The producer embeds the **full data-model POJO projection
    at the REAL pre-minted id, `type` included** (`InvitationCreated.object` =
    `CreateInvitationPojo` — the stored POJO minus the fields the workflow
    must generate/receive: `capabilityUrl`, `registeredAgent`). The embedded
    node's `rdf:type` claim in the activity graph is kept out of
    authoritative reads by the **self-graph read convention**
    (`docs/sparql.md`: classification queries filter `GRAPH ?g` …
    `FILTER(?g = ?s)`) — the write-path rule "never embed type at a real
    id" is superseded by that read-side filter (decided with step 1). The
    workflow input is the decoded object **verbatim** — the handler passes it
    through; the shared pojo type (`CreateInvitationPojo`) is the single
    source in `data-model`.
  - **snapshot** — the id is unknown at write (`InvitationAccepted` — the
    acceptor has no owning container to mint in): the producer
    mints a `urn:uuid` node and embeds the full data-model POJO projection
    (id = `urn:uuid:…`, `type` incl. the class IRI, …fields) inline in the
    activity graph. The singly-fetched activity document already contains
    the node, so the **pinned single-doc read applies unchanged**:
    `@embed: '@always'` on `object` returns the full node, `@never` (the
    default) returns `object: { id }`. The `urn:uuid` is **never dereferenced**
    — a stable in-graph identity (same convention as notification ids). The
    `type` array may carry the ASV activity type alongside the class
    (`as:Accept`, `as:Create`, … — new ActivityStreams terms).
- **No new field predicates — parties ride the object (amendment).** The
  duplicate-`@id` rule (one predicate IRI per context term) plus the ASV
  pivot make every previously-flat party/role field either ride inside the
  embedded object or reuse an existing term: `grantee`/`dataOwner`
  (`GrantsRevoked`) reuse the existing interop terms; `admin`,
  `authorizationGrantee`, `peerId` are **not flat fields** — consumers read
  them from the object (`grantee`, `registeredAgent` inside the embedded or
  linked POJO); `roleId` ≡ `target`; `peers` and the grantee kind are
  derived by the workflow/consumer from the object. The interop field
  predicates invented in the initial flat attempt (`admin`,
  `authorizationGrantee`, `hasPeerAgent`, `hasPeer`, `hasRole`, `hasGrant`,
  `hasInvitation`, `hasSocialAgentRegistration`) are **retired**. The only
  additions are standard ActivityStreams terms (`as:target`, `as:object`,
  `as:Accept`, `as:Create`, `as:Add`, …).
- **Structure-based classes stay flat (decided — followup).**
  `AuthorizationRequested`/`ShareRequested` keep their flat
  `authorization: <structure>` field: embedding the structures would need
  structure-field terms (`accessNeed`, `agentType`, `granted`,
  `applicationId`, `resource`, `children`, `agents`, …) — the structures'
  own serialization vocabulary, unrelated to the activity context.
  **Followup:** the flat `authorization: <structure>` carrier (and the fate
  of `AuthorizationRequested`/`ShareRequested` — **use** them, completing
  their routing, **or drop** them) is decided by
  [`authorization-granting.md`](authorization-granting.md) (Decision A — the
  granting leg; supersedes the stale "activity-first steps 2–3" reference).
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

> **Note (latest amendment):** the step-1 sketch above shows the *initial*
> flat shapes — the Object-embedding amendment and the inventory below are
> the current wire truth (`as:object` forms per class, no new field
> predicates). The union itself is unchanged; only per-class field sets
> follow the amendment.

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
> **⚠️ Superseded shape note (latest amendment):** this step-3 sketch
> describes the **initial flat** wire (flat plain-IRI fields + invented
> interop field predicates). The Object-embedding amendment and the
> inventory below are the **current wire truth**: `as:target`/`as:object`/
> `as:*` types, `as:object` live-link/snapshot forms, no new field
> predicates. Implement the amended shape (flip mechanics + naming unchanged;
> field sets per the inventory), not this sketch.
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
schema/type from the POJO (`Pick`/field-map) so a POJO field change fails the
message build at compile time. The `X.make()` mappers in services stay the
translation seam. (The `prefLabel` → `label` rename is now historical — the
label unification landed: `label` is the single term for `skos:prefLabel` in
the model, on the wire and in the messages, so the seam no longer renames.)
**Not renaming data-model fields for UI** — framing is RDF-faithful. Decide in
review; orthogonal to steps 1–3.

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
`SocialAgentId`, `AgentId` refs appear only in temporal inputs/builders.

**`target` rule (InvitationCreated precedent — landed):** a class whose
changed-record id rides `object.id` (the real-id embedded form) DROPS
`target`; a class whose `target` is a delivered value (a role/peer dispatch
anchor) or the completion target keeps it. Removed: `InvitationCreated`
(step 1), `InvitationAccepted` + `AgentRegistrationAdded` (the invitation
legs aligned to the template). Scheduled removals with their re-pins:
`AuthorizationRecorded`/`Revoked` (steps 2–3),
`RoleMembershipChanged`/`RoleDeleted` (steps 4–5),
`AdminAuthorizationRecorded`/`Revoked` (steps 7–8). Kept:
`DelegatedGrantsUpdated` (consumed as `peerId`), `ActivityCompleted` (the
completion machinery's payload).

**Object-embedding scope (amendment — latest):** the flat rows below are the
**target** design — the `as:object` forms per class (see the §2 decision); only
`AuthorizationRequested`/`ShareRequested` stay flat (structure-based, followup
in §5).

| Class (`type[1]`) | Flat interface fields (data-model, `activities.ts` — wire truth) | producer | consumer (workflow / input) |
|---|---|---|---|
| `InvitationAccepted` | `actor: string; object: EmbeddedSocialAgentInvitation` (minted `urn:uuid` snapshot — full `SocialAgentInvitationData`: `type` incl. `SocialAgentInvitation`, `capabilityUrl`†, `label`, `note`); `type: ['Activity', 'InvitationAccepted', 'as:Accept']` — **no `target`** (the acceptor's registry-set id was never consumed; id-unknown-at-write keeps the snapshot form) | `acceptInvitation` (SocialAgentRegistry.ts) | `acceptInvitation` workflow — the decoded object passes verbatim; completion rides the `InvitationAcceptedId` ref |
| `InvitationCreated` *(new — activity-first step 1)* | `actor: string; object: CreateInvitationPojo` — the invitation-to-be at the REAL pre-minted id: `{ id, type: [SocialAgentInvitation], label, note? }` (embedded projection with `type` — the sparql.md self-graph read rule keeps activity-graph type claims out of authoritative queries; **no `capabilityUrl` in the activity** — the workflow generates it when creating the invitation, so the UI can't learn it before the invitation exists and the activity completed); `type: ['Activity', 'InvitationCreated', 'as:Create']` | `createInvitation` RPC (activity only — mints the invitation id, writes the activity) | `createInvitation` workflow (new) — PUTs the invitation at the minted id (the passed object), generates the capabilityUrl, then completes |
| `AgentRegistrationAdded` | `actor: string; object: EmbeddedSocialAgentRegistration` — the registration-to-be at the REAL pre-minted id (the handler pre-mints via `iriForContained`; `registeredAgent` — the peer, `label`, `note`); `type: ['Activity', 'AgentRegistrationAdded', 'as:Add']` — **no `target`** (the changed record's id rides `object.id`, the InvitationCreated form); the `establishReciprocal` workflow PUTs the registration there (the synchronous handler create moved into the workflow) | `InvitationHandler` (pre-mints the registration id via `iriForContained`, writes the activity) | `establishReciprocal` — workflow PUTs the registration at `object.id` (find-first), discovers the reciprocal; completion rides the `AgentRegistrationAddedId` ref |
| `AdminAuthorizationRecorded` / `AdminAuthorizationRevoked` | `actor: string; target: <AuthorizationRegistry>; object: <AdminAuthorization IRI>` (Recorded: pre-minted — the workflow PUTs it; Revoked: the existing id — the workflow DELETEs) | `Admin.ts` `addAdmin`/`removeAdmin` (activity only) | `processAdminChange` — reads `grantee` from the object |
**Re-pin (steps 7–8, InvitationCreated form):** once the workflow materializes/deletes the AdminAuthorization, the object becomes the **real-id embedded projection** (`{ id, type: [AdminAuthorization], grantee, grantedBy, scopeOfAuthorization }` at the pre-minted/existing id) — dispatch must not dereference a not-yet-PUT (Recorded) or already-deleted (Revoked) resource; the handler/consumer reads `grantee` from the embedded projection (today the RPC records/deletes synchronously and the object is an urn snapshot — execution notes). **`target` is REMOVED with that re-pin** (steps 7–8) — nothing consumes the container and the id rides `object.id` (InvitationCreated precedent). |
| `AuthorizationRecorded` / `AuthorizationRevoked` | `actor: string; target: <AuthorizationRegistry>; object: <DataAuthorization IRI>` (Recorded: pre-minted — the workflow PUTs it; Revoked: the existing id — the workflow DELETEs) | `Authorization.ts` `recordAuthorization`, `ShareResource.ts` `shareResource` | per-grantee consumer / `CreateGrantsInput` — reads `grantee` from the object |
**Re-pin (steps 2–3, InvitationCreated form):** when the workflow records the authorization at the pre-minted id, the object becomes the **real-id embedded projection of the DataAuthorization-to-be** (`{ id, type: [DataAuthorization], grantee, … }`) — the grantee resolves from the embedded fields, never by dereferencing (the live-link set + 404-tolerant `granteeFromDataAuthorization` is the current synchronous-RPC fallback, execution notes). One activity per deduped grantee — share writes several. Denied stays an urn snapshot (execution notes) until its long-term home in `AuthorizationRevoked`. **`target` is REMOVED with that re-pin** (steps 2–3) — nothing consumes the container (grantee rides the object) and the id rides `object.id`. |
| `RoleMembershipChanged` / `RoleDeleted` | `actor: string; target: <role IRI>` (the object is the same IRI — live link, the role is alive at write; the workflow loads its members, applies the change / deletes, and derives the affected diff itself — `peers` and `roleId` are not activity fields) | `RoleRegistry.ts` `updateRole`/`deleteRole` (activity only — the role write moves to the workflow) | `processRoleMembershipChange` / `processRoleDeletion` |
**Carrier re-pin (step 4, InvitationCreated form):** the role's *intended* `label`/`members` (the change) ride the object as a **real-id embedded projection of the role-to-be** (`{ id: target, type: [Role], label, members }`) — the workflow PATCHes the role from the object and derives the diff; the role's current state is still read at workflow time for the before-image (`deleteRole` needs `members` before deleting). **`target` is REMOVED with that re-pin** (steps 4–5) — the embedded `object.id` ≡ the role, so `roleId` reads `object.id` (today `target` ≡ role and is consumed as the dispatch anchor).
| `DelegatedGrantsUpdated` | `actor: string; target: <the peer>; object: <reciprocal registration IRI>` (`peerId` derivable — `registeredAgent` inside) | `ReciprocalWebhookHandler` | `updateDelegatedGrants` / `FindAffectedAuthorizationsInput` |
| `GrantsRevoked` | `actor: string; grantee: string; dataOwner: string; object: [<grant IRIs>]` (`as:object` set — the revoked grants; `grantee`/`dataOwner` reuse the existing interop terms) | `Revocation.ts` `revokeGrants` *(producer lands in activity-first step 6)* | `processGrantsRevocation` / `ProcessGrantsRevocationInput` |
| `ActivityCompleted` | **no own fields** — `target: string` (plain IRI — the completed activity IRI; its type is found by reading the target, not embedded in the completion) | `markActivitiesDone` / `ActivityRegistry.createCompletion` | forwarding only |
| `AuthorizationRequested` *(candidate — NOT adopted; flat carrier, fate decided by [`authorization-granting.md`](authorization-granting.md) Decision A — use or drop)* | `actor: string; target: <AuthorizationRegistry>; authorization: AuthorizationStructure‡` (flat — structure-based, followup) | `authorizeApp` RPC *(only if adopted)* | `processAuthorizationRecorded` (new, only if adopted) |
| `ShareRequested` *(candidate — NOT adopted; flat carrier, fate decided by [`authorization-granting.md`](authorization-granting.md) Decision A — use or drop)* | `actor: string; target: <data registry>; authorization: ShareDataInstanceStructure‡; applicationId: string` (flat — structure-based, followup) | `shareResource` RPC *(only if adopted)* | `processShareRequested` (new, only if adopted) |

† `capabilityUrl` is deliberately the one protocol-opaque plain string
(`federation.md`) — the acceptor must not parse it and never learns the
invitation id, so no ref object is possible. `label`/`note` are literals.

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

**Adding a new activity class (the compile-time rule — extended with the
step-1 conventions):** its interface goes into the `ActivityData` union in
`data-model` (plus vocab term + context entry) — a producer can then only
emit a typed activity; the handler, `reconcileActivities` and `events.ts`
each add their row to stay exhaustive. For a workflow-materialized class
(pre-minted resource the workflow PUTs), the step-1 additions are:

- the **shared object pojo** in `data-model` next to the class (the
  `CreateInvitationPojo` pattern: the stored `*Data` minus the fields the
  workflow generates/receives), typed as the class's `object`;
- the **activity ref** (`InvitationCreatedId` pattern: `{ id, type }` — the
  XId convention) carried by the workflow's completion;
- **multi-param workflow/activity signatures** (`<class>(webId, object,
  activity-ref)` / activity `(webId, object)`) — the activity ref never
  rides the activity's own args;
- the handler passes the **decoded object verbatim** as the workflow input
  (mutability spread for `type` where the schema decodes readonly);
- the **`ACTIVITY_LABELS` row** in `ui/authorization/src/activityLabels.ts`
  (the step-0 indicator label map).

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
- Renaming RDF-faithful POJO fields to UI names, e.g. `label` → a UI label
  key. (The `prefLabel` → `label` unification is **executed**: `label` is the
  single term for `skos:prefLabel` — data-model, wire, messages; stray
  `rdfs:label` migrated to `skos:prefLabel`, see the sparql.md graph-scoping
  note for the read plane.)
- **Structure-based classes stay flat + followup (decided).**
  `AuthorizationRequested`/`ShareRequested` keep `authorization:
  <structure>` as a flat field (see §2 decision) — embedding the structures
  would need their own serialization vocabulary (`accessNeed`, `agentType`,
  `granted`, `applicationId`, `resource`, `children`, `agents`, …).
  **Followup (eval when activity-first steps 2–3 land):** other approaches
  for the structure payload — a dedicated structure vocab/context, a
  snapshot-embed with `urn:uuid` (the object-embedding pattern), reusing the
  RPC shape as-is, or an `as:object`-style link to a stored description.
- **Multi-graph read-embedding — deferred, except `as:object` (explored,
  amended).** Returning `{ id, type }` refs from `loadActivity` by
  framing/querying across named graphs (each resource in its own
  `GRAPH <iri>`, name == resource IRI) is viable and plane-consistent, but
  adds per-read cross-graph queries and yields only best-effort `type`
  (agent identities — `actor`/`peerId`/`grantee` — lack `rdf:type` in their
  own graphs today, incl. remote peers) and nondeterministic read shapes if
  the dataset differs per caller. **Amendment (object-embedding decision):**
  the `as:object` field is exempted — live-link objects embed by
  GRAPH-unioning the object's named graph (the object IS a stored typed
  resource, so the embed is deterministic), snapshot objects embed within
  the single fetched document (no cross-graph read at all). All other fields,
  and the general cross-graph read, stay deferred; revisit the idea on its
  own if read plane consistency demands it.
- Keeping `interop:activityType` / `interop:payload` on the wire (retired by
  step 3; note the deviation from the spec vocabulary — this registry is
  internal, extended freely).
- Any RPC/response-shape change of `activity-first-services.md`.
## Execution notes (committed — `payload contract alignment`, then the flip)

Steps 1–2 shipped in the committed base; **step 3 (THE FLIP) with the amended
`as:object` shape landed on top** and the wire is now typed classes end-to-end
(`LegacyActivityData` deleted; `/test` 150/150 green). The amendments + the
inventory were implemented as written, **with these execution-time
decisions** (authoritative over the step sketches where they differ):

1. **`type` order is unordered** — JSON-LD `@type` is a set; the SPARQL store
   frames it back in any order. `loadActivity` finds the class by set
   membership (`activityClass` — excludes `Activity` and the `as:*` terms) and
   **canonicalizes** to `['Activity', '<Class>', <as:*>]`, so every consumer
   (handler decode, pending filters, reconcile, events bus, UI) sees the
   canonical tuple and the Schema `S.Tuple` decodes hold.
2. **Snapshot `type` frames as a scalar for a single rdf:type** —
   `loadActivity` normalizes embedded-object `type` scalar→`string[]` when
   building the `Embedded*` POJOs (the schemas require arrays).
3. **`adminAuthorizationRecorded`/`adminAuthorizationRevoked` object = urn:uuid
   SNAPSHOT of the AdminAuthorization (grantee inside)**, not the live link —
   the RPC records/deletes the resource synchronously (R1), so dispatch never
   dereferences (a live link would 404 for the revoked case). Monitor:
   `activity-first-services.md` steps 7–8 re-pin the form when the workflow
   materializes/deletes.
4. **`AuthorizationRecorded.object` (granted) = the DataAuthorization live-link
   SET** (one activity per deduped grantee — share writes several); **(denied)
   = an `EmbeddedAuthorization` urn:uuid snapshot** of the request structure —
   `granted:false` creates no DataAuthorization, so the grantee rides the
   snapshot. The deny path's long-term home is `AuthorizationRevoked` (see
   `events.md` / `authorization-revoked.md`).
5. **`RoleMembershipChanged`/`RoleDeleted` object = the affected/former member
   plain-IRI SET** while the RPCs still PATCH/DELETE synchronously — the
   inventory's live-link role-object form assumes the workflow derives the
   diff (steps 4–5). `target` ≡ the role throughout.
6. **`typeGrantee` made public** on `AuthorizationAgent` — the store-side
   grantee-kind resolution (roleg/social/application) used by the handler and
   the grantee-from-object resolution.
7. **Grantee-from-object resolution is 404-tolerant** and only touches
   **pending** activities — completed activities may legally reference deleted
   DataAuthorizations (a later deny removes them) and are never dereferenced.
8. New dev-verb: `grants.test.ts`/`activity-registry.test.ts` vitest pin the
   deny resolution, snapshot normalization, canonicalization and the
   unordered-type behavior.
9. **Structure types — the term-gap trap (observed, affects the §2/§5
   followup).** `AuthorizationStructure`/`DataAuthorizationStructure`/
   `ShareDataInstanceStructure` fields (`agentType`, `granted`, `accessNeed`,
   `scopeOfAuthorization`, `applicationId`, `resource`, `children`, `agents`,
   …) have NO `dataModelContext` terms. JSON-LD expansion **silently drops
   unknown keys on write** — observed in the deny snapshot: `agentType` and
   `granted` vanished from the framed object (only term-covered fields
   survived). A worked around it by trimming the deny snapshot to
   term-covered fields (`grantee`, `hasAccessNeedGroup`) + the
   `INTEROP.AuthorizationStructure` vocab term (deny's kind resolves via the
   store and `granted:false` is implied by the snapshot's existence).
   **Future iteration (steps 2–3, `AuthorizationRequested`/`ShareRequested`,
   or the §5 followup) must account for this:** ANY structure-on-the-wire
   form — the flat `authorization: <structure>` field OR a snapshot-embed
   (the nested node's keys need terms too) — requires either a dedicated
   structure field vocabulary/context (the plan's candidate #1), expanded-form
   writes with full-IRI keys, or the link-to-stored-description candidate —
   otherwise fields silently drop. Also: the `AuthorizationStructure` term and
   `EmbeddedAuthorization` may be superseded if the deny path lands its
   long-term home as `AuthorizationRevoked` (`events.md` /
   `authorization-revoked.md`) — re-check before steps 2–3 harden the shapes.

10. **Invitation legs aligned to the step-1 template (activity-first steps
    0–1).** Both invitation activities now follow the `InvitationCreated`
    form and the settled conventions:
    - **`target` dropped** on `InvitationAccepted` (the acceptor's
      registry-set id was never consumed) and `AgentRegistrationAdded` (the
      changed record's id rides `object.id` — the REAL pre-minted
      registration id; the handler pre-mints the **container form**
      `iriForContained(…, true)` — omitting the flag broke the workflow's
      registration PUT with a CSS "Content-Type required" 400, since social
      agent registrations are containers).
    - **Typed activity refs** — `InvitationAcceptedId` /
      `AgentRegistrationAddedId` (`{ id, type }`, the XId pattern) ride the
      workflows' completions (`markActivitiesDone` on the ref, like
      `InvitationCreatedId`).
    - **Multi-param signatures** — `acceptInvitation(webId, object,
      accountId, activity: InvitationAcceptedId)` / `establishReciprocal(
      webId, registration, accountId, activity: AgentRegistrationAddedId)`;
      the activities take `(webId, object)`; the decoded object passes
      **verbatim** from the handler (`AcceptInvitationInput` /
      `ReciprocalRegistrationInput` deleted).
    - **Mint-in-service on the inviter side** — `InvitationHandler` pre-mints
      and writes the activity only; the synchronous registration create moved
      into `establishReciprocal` (`reciprocalRegistration` PUTs at
      `object.id` find-first, including the ACR setup mirroring
      `addSocialAgentRegistration`). The `AgentRegistrationAdded` object is
      thus the real-id embedded projection (the urn snapshot form is now used
      only where the id is genuinely unknown at write — `InvitationAccepted`).
