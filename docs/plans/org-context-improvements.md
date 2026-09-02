# Invitation acceptance via `invitationAccepted` + workflow — unified for personal and org contexts

> **Status:** **implemented** (awaiting the `/test` run — dagger, user-side) —
> `AcceptInvitation` records `invitationAccepted` in the acceptor's Activity
> Registry (own or org) and returns `{ accepted: true }`; the acceptor's
> `acceptInvitation` Temporal workflow POSTs the opaque capabilityUrl as the
> acceptor, builds the acceptor → inviter registration + reciprocal and marks
> the activity done. Flow sketched end-to-end in the `admin-invitation-receive`
> view of `docs/temporal.c4`.
>
> Scope: **all** invitation accepts — personal (the user accepts with their own
> context) and org (an admin accepts on behalf of the org) — go through the
> same activity-first pipeline: the acceptor's AA records an `invitationAccepted`
> activity, and the **acceptor's own** Temporal workflow performs the capabilityUrl
> POST and builds the acceptor-side registration.
>
> Complements `org-admin-feature.md` (RPCs in org context), `org-context-sparql.md`
> (session model), `events.md` (activity catalogue), `federation.md` (cross-server
> protocol), `workflow-temporal-decupling.md` (Temporal), and the invitation
> tests in `/test/invitation.test.ts`.
>
> Decision (reviewed): `invitationAccepted` is a **new activity type** — not a
> reuse of `agentRegistrationAdded` — with its own `acceptInvitation` workflow.

## Scenario

The invited party (for clarity: **the acceptor**) receives a capabilityUrl out of
band:

- **Personal**: Bob receives Kim's invitation and calls `AcceptInvitation` with
  `context: bob`.
- **Org**: Dan, admin of YoYo, receives Kim's invitation and calls
  `AcceptInvitation` with `context: yoyo` (accepting on behalf of the org).

Both resolve to a `ResolvedContext` whose `registrySet` is the **acceptor's**
(local for personal, the org's for admin) and whose `webId` is the acceptor
identity (`bob` / `yoyo`). The rest of this plan is identical for both — the
words "the acceptor" cover both a personal agent and an org.

### Expected end state (correct — same for both contexts)

| # | Artifact | Where | Owner of the write |
|---|---|---|---|
| 1 | `inviter → acceptor` SocialAgentRegistration | the inviter's registry | the inviter's AA (via the capabilityUrl POST) |
| 2 | `agentRegistrationAdded` activity + **the inviter's** `establishReciprocal` (reciprocals both ways, webhook subscription, completion) | the inviter's Activity Registry | the inviter's AA (unchanged machinery) |
| 3 | `acceptor → inviter` SocialAgentRegistration with `reciprocalRegistration → inviter → acceptor` | the acceptor's registry | the acceptor's AA (the `acceptInvitation` workflow) |
| 4 | invitation gets `registeredAgent = <acceptor webId>` | the inviter's Invitation Registry | the inviter's AA (via the POST) |
| 5 | `invitationAccepted` completion activity | the acceptor's Activity Registry | the acceptor's AA (the workflow) |

## Protocol contract: the capabilityUrl is opaque

`federation.md` is about deployments where the inviter's AA, the acceptor's AA
and the admin's AA/UAS can be **different servers, even different codebases**.
The capabilityUrl is therefore a **capability token issued by the inviter's AA**
and:

- **opaque to everyone except the issuing AA** — the inviter's AA is the only
  party that parses it (it looks up the invitation in its **own** Invitation
  Registry); its internal structure (base64 segment, uuid) is an
  implementation detail and is **not** part of the protocol;
- must be stored and forwarded **verbatim**: the RPC puts it in the activity
  payload, the workflow POSTs it unchanged;
- no party decodes it to learn the inviter's webId — **the inviter's webId is
  learned from the POST response** (below).

### The common accept protocol (already used by the personal flow)

```
POST <capabilityUrl>         ← the acceptor's AA, with the acceptor's credentials
  200 text/plain: <inviterWebId>   ← issued and answered by the inviter's AA
```

The inviter's AA authenticates the POSTer from its credentials (the acceptor's
identity), looks up the invitation behind the opaque token in its own registry,
creates **its** registration of the acceptor, and returns the **inviter's
webId** in the response body — this is the only way the acceptor's AA learns
who it is establishing a relationship with. No parsing of the token. This works
unchanged across servers/codebases: it is plain HTTP + Solid OIDC/DPoP
credentials.

`InvitationHandler` (`packages/components/src/InvitationHandler.ts`) is the
inviter-side implementation of the protocol and **stays unchanged** — it owns
the decode, runs with the inviter's own session, and derives the acceptor from
the POSTer's credentials.

## The bug this fixes (org context, the trigger for this plan)

`ResolvedContext.session` is **always the signed-in user's own AuthorizationAgent**
— no org session is minted for RPCs (`packages/components/src/services/Context.ts`,
deliberate invariant from `org-context-sparql.md` phase 3). The old synchronous
`acceptInvitation` (`packages/components/src/services/SocialAgentRegistry.ts:184`)
performed two identity-sensitive **cross-AA** steps with `ctx.session`:

1. **POST capabilityUrl as Dan** → `InvitationHandler` derives the acceptor from
   the POSTer's credentials = **dan** → creates **Kim's registration of Dan**
   (spurious pair!) + `agentRegistrationAdded` (kim↔dan) → Kim's
   `establishReciprocal` starts for the **wrong pair**, and the invitation is
   marked accepted **by Dan**.
2. `ctx.session.discoverAndUpdateReciprocal(...)` HEADs Kim's UAS **as Dan** →
   answers with Kim's registration of Dan → the org's registration reciprocal is
   wrong/missing.

### Root cause

The org-context design says the admin's RPC operates on the org's **registries**
but must not become the org's **identity** for cross-AA interactions: both the
capabilityUrl POST and the reciprocal discovery produce different results
depending on **whose credentials** run them. The fix is to never run those legs
from the RPC at all — run them from the **acceptor's own AA session**, always,
personal included.

## Resolution (decided direction) — unified activity-first

**Every accept records an `invitationAccepted` activity in the acceptor's
Activity Registry; the acceptor's own Temporal workflow (running as the
acceptor — a personal agent or the org) performs the cross-AA legs.**
Durable, retried, idempotent — consistent with `events.md` /
`workflow-temporal-decupling.md`. The RPC becomes context-agnostic; personal and
org accepts differ only in *whose* Activity Registry and *whose* session is
used — both already flow through the same webhook/handler mechanics.

The acceptor already has a first-class AA session in the worker: temporal
activities build it with `buildSessionManager().getSession(payload.webId)`
(`packages/components/src/temporal/activities/reciprocal.ts`) — true for orgs
(<code>yoyo</code>) and personal agents alike, and already exercised by the
inviter-side `establishReciprocal` in both. Nothing new is needed to "be" the
acceptor.

### `ActivityWebhookHandler` readiness

Already generic for this in either case (`packages/components/src/ActivityWebhookHandler.ts`):

- **per-type dispatch map** (`activityWorkflows`, line 45) — a new row for
  `invitationAccepted` is all the type routing needs;
- **owner vs admin channel** (`isRegistryOwner`, line 115) — a channel whose
  webId owns the Activity Registry dispatches the workflow; this holds for the
  user's personal channel (topic = own registry) and the org's owner channel
  alike. An admin's observer channel (org context) forwards only — pending →
  done into the admin's stream for free;
- **forward-before-dispatch** (line 87) — every `Add` produces the event line,
  so the acceptor's own UI and the admin's stream both see pending → done;
- **`accountId` pass-through** (line 193) — currently special-cased for
  `agentRegistrationAdded`; extend the same conditional to `invitationAccepted`
  (uniform input shape; the workflow itself only needs it if it subscribes
  webhooks — the accept flow does not, see Phase C).

So the handler needs exactly: one `activityWorkflows` row + one `||` in the
`accountId` conditional. No structural changes.

### Phase A — RPC: record the activity (acceptInvitation, both contexts)

`acceptInvitation(ctx, { capabilityUrl, label, note })` becomes context-agnostic
(no `ctx.webId !== ctx.userWebId` branch):

1. **No POST, no decode, no registration creation** — the capabilityUrl is
   opaque and the inviter's webId is unknown at this point.
2. Write the domain activity to `ctx.registrySet.hasActivityRegistry`
   (`ActivityRegistry.createActivity`, exactly like `RoleRegistry.updateRole`),
   payload: `{ webId: { id: ctx.webId, type: SocialAgent }, capabilityUrl, label,
   note, createdAt }` — `capabilityUrl` verbatim (opaque); `label`/`note` are
   what the acceptor calls the inviter (used by the workflow for
   `acceptor → inviter`); **no `peerId`, no `registrationId`** — only the
   workflow learns those.
3. Return a minimal **pending acknowledgment** — `{ accepted: true }` (the shape
   drawn in `admin-invitation-receive`; the RPC result can no longer be the
   registration profile — **for personal accepts too**, see Open Questions).

Personal and org differ only in `ctx.registrySet` (own vs org) and `ctx.webId`
(own vs org) — no other branch.

### Phase B — dispatch: webhook → acceptor's workflow

Unchanged structurally (`ActivityWebhookHandler` readiness above): the activity
lands in the acceptor's Activity Registry (own or org); the **owner channel**
dispatches `acceptInvitation`; in the org case Dan's **admin channel** forwards
pending → done to Dan's events stream. The workflow runs on the existing
`reciprocal-registration` task queue (`packages/components/src/workers/main.ts`)
— no new queue/worker.

### Phase C — workflow: the acceptor's AA performs the acceptance

New `acceptInvitation` workflow, input `{ accountId?, webId, capabilityUrl,
label?, note?, activityIri }`, running as **the acceptor's session**
(`payload.webId`):

1. **POST the opaque capabilityUrl as the acceptor** — the common accept
   protocol; the inviter's AA (possibly a different codebase) authenticates the
   acceptor, creates `inviter → acceptor` + `agentRegistrationAdded` in the
   **inviter's** registry + `setRegisteredAgent(acceptor)`, and responds with
   the **inviter's WebID** — the only place the inviter's identity is learned.
   The inviter's own `establishReciprocal` proceeds from there (phase 2 in the
   table above).
2. **Create `acceptor → inviter`** with the inviter webId from the POST response
   and the payload's `label`/`note` (`find`-first — idempotent under retries).
3. **Reciprocal (acceptor side)** — `session.discoverAndUpdateReciprocal` as the
   acceptor: HEAD the inviter's UAS → `inviter → acceptor` (exists after step 1)
   → PATCH `acceptor → inviter` reciprocal.
4. **Mark the activity done** — `markActivitiesDone` → completion in the
   acceptor's Activity Registry → the acceptor's UI stream `done` (and, for the
   org case, Dan's admin stream via the observer channel).

No webhook subscription on the acceptor side — `reciprocalWebhook` remains the
inviter side's job (it subscribes to `acceptor → inviter`, unchanged).

Retry policy mirrors `establishReciprocal`'s (`reciprocalRegistration` proxy:
5s initial, ×2, 10 attempts), so a flaky POST retries without losing the event.
A genuinely invalid/expired capabilityUrl exhausts retries and leaves the
activity pending — surfaced as an error event.

## What stays unchanged

- `InvitationHandler` — the inviter-side protocol implementation, including the
  (owner-only) capabilityUrl decode.
- The inviter side: `agentRegistrationAdded` → the inviter's `establishReciprocal`
  → reciprocals both ways, webhook subscription, completion, done event to the
  inviter's UI.
- `Context.ts` invariant (no org session in RPCs) — the org session exists only
  inside the worker.
- The green admin **send** scenario (Dan creates an invitation for the org) —
  its **accept** leg changes shape (now the acceptor's `invitationAccepted`
  workflow drives it), but the invitation creation side is untouched.

## Implementation checklist

1. `packages/components/src/services/SocialAgentRegistry.ts` — `acceptInvitation`
   rewritten to activity-first for **both** contexts (decode-free, POST-free,
   discovery-free; pending ack response).
2. `packages/api-messages` — `AcceptInvitation` result type → pending
   acknowledgment (`{ accepted: true }`); update `ui/authorization`'s
   `acceptInvitation` consumer + list refresh.
3. `packages/components/src/ActivityWebhookHandler.ts` — `invitationAccepted` row
   in `activityWorkflows` + `||` in the `accountId` special case.
4. `packages/components/src/temporal/activities/reciprocal.ts` (or new) —
   `acceptInvitation` activity: POST the opaque capabilityUrl as `payload.webId`'s
   session, return the inviter webId.
5. `packages/components/src/temporal/workflows/reciprocal.ts` (or new) —
   `acceptInvitation` workflow: POST → create `acceptor → inviter` → reciprocal →
   `markActivitiesDone`.
6. `docs/plans/events.md` — `invitationAccepted` row: producer = `acceptInvitation`
   (acceptor's Activity Registry, own or org), consumer = `acceptInvitation`
   workflow.
7. Tests: rework the invitation tests (below) + `packages/*` unit tests for the
   workflow/activity.

## Tests (rework — all invitation accepts become wait-for-workflow)

All three scenarios share one shape; each asserts the end state with waits.

```
describe('personal invitation (dan creates; kim accepts)')
  - dan creates invitation (RPC, context dan)
  - kim accepts (RPC, context kim) → assert { accepted: true } (no profile)
  - waitFor: kim→dan registration exists + reciprocal (kim's workflow → POST as kim)
  - waitFor: dan→kim registration exists + reciprocal + completion in dan's registry
  - waitFor: completion of kim's invitationAccepted in kim's registry
  - assert NO spurious pair (e.g. no dan↔kim cross-wiring) — regression guard

describe('admin send (dan invites kim to yoyo; kim accepts)')
  - dan creates invitation (RPC, context yoyo)
  - kim accepts (RPC, context kim) → assert { accepted: true }
  - waitFor: kim→yoyo registration + reciprocal (kim's workflow → POST as kim)
  - waitFor: yoyo→kim registration + reciprocal + completion in yoyo's registry
  - waitFor: kim's invitationAccepted completion in kim's registry
  - optionally: dan's stream receives yoyo's agentRegistrationAdded pending→done

describe('org receive (kim invites yoyo; dan accepts as admin)')
  - kim creates invitation (RPC, context kim)
  - dan accepts (RPC, context yoyo) → assert { accepted: true }
  - waitFor: yoyo→kim registration exists (dan's workflow → POST as yoyo)
  - waitFor: yoyo→kim reciprocal (workflow outcome)
  - waitFor: kim→yoyo registration + reciprocal (inviter side via the POST)
  - waitFor: completion in yoyo's Activity Registry AND kim's Activity Registry
  - assert NO kim→dan registration exists (the old bug must not regress)
  - optionally: dan's events stream receives invitationAccepted pending→done
```

Seed needs: kim's account cookie (added for the invitation tests,
`kv.json` `accounts/cookies/77b0674a-…`), host activity webhook channels
(present), no seeded relationship between the fresh pairs used by a test
(dan↔kim, kim↔yoyo — verified fresh; alice↔bob is seeded and unusable).

## Open questions

1. **Activity type** — **decided:** new `invitationAccepted` + own workflow
   (confirmed in review).
2. **RPC response shape** — pending ack applies to **personal accepts too**
   (previously synchronous profile). Confirm the UI/UX of the pending state in
   both contexts (refresh-based list, like `AddAdmin`).
3. **Activity `target`** — drawn as the acceptor's **RegistrySet**
   (`https://registry/<acceptor>/`; `https://registry/yoyo/` in the diagram) —
   consistent with the `adminAuthorizationRecorded` precedent of targeting the
   org's registry container.
4. **Idempotency** — repeated accepts of the same capabilityUrl (two admins /
   retries): the workflow's POST is idempotent on the inviter side
   (`InvitationHandler` skips existing registrations, re-sets
   `registeredAgent`), `acceptor → inviter` is `find`-first, each activity gets
   its own completion. Confirm no extra dedupe needed.
5. **ACR creator** — the registration is created by the **acceptor's session in
   the workflow**, so `creator = { agent: payload.webId, client: <acceptor
   session's agentId> }` — the natural, correct identity for both contexts.
6. **`accountId`** — pass it for uniformity with `agentRegistrationAdded`; the
   accept workflow itself does not subscribe webhooks, so it may be unused.
7. **Docs** — align notes of `admin-invitation-receive` with the shipped code
   after implementation; update the `invitation` and `admin-invitation-send`
   views to the acceptor-side `invitationAccepted` flow once green; add the
   `invitationAccepted` row to `events.md`; add the opaque-capabilityUrl accept
   protocol to `federation.md`.

## Alternative considered (rejected)

**Option A — run the POST + discovery synchronously with a minted org session in
the RPC** (`getSession(yoyo)` inside `acceptInvitation`): small diff for the org
case. Rejected: breaks the `Context.ts` invariant and the unification symmetry,
adds a special-case cross-AA HTTP call into the admin RPC path with no
durability, and doesn't fit the established "RPC records → workflow materializes"
model (`events.md`). This plan keeps the RPC synchronous-only-with-its-own-
authority and pushes the cross-AA, identity-sensitive work into retryable
Temporal execution — for **every** acceptor, personal or org.