# Social graph — inter-peer connection topology

> Describes how the systems of *different* peers in the social graph interact.
> The internal webhook (`ActivityWebhookHandler` on the account's own Activity
> Registry) is **not** inter-peer and is out of scope here — except that the
> **org-admin channel** (a webhook on *another peer's* — the org's — Activity
> Registry container, feeding the admin's `ActivityWebhookHandler`) *is* an
> inter-peer push edge; it is covered in §2 and §7.

## 1. Connection tiers

Inter-peer interactions come in three tiers; only the first is event-driven.

| Tier | Kind | Direction | Examples |
|---|---|---|---|
| 1 | **push webhook** | peer registry → our handler | reciprocal webhook (per pair); org activity-registry admin channel (per administered org, §2/§7) |
| 2 | one-shot request/response HTTP | initiatee → responder | invitation POST, delegation issuance POST, agent-id discovery doc |
| 3 | authenticated pod reads/writes | our agent session ↔ peer pod | reciprocal discovery, ACR writes, profile/grant reads, org-context registry access (§7) |

## 2. Tier 1 — the reciprocal webhook (the per-pair push edge)

- **Created** by the `establishReciprocal` workflow (`temporal/activities/reciprocal.ts`), triggered only by an `agentRegistrationAdded` activity, written only by the **inviter's** `InvitationHandler`. Subscriptions are deduped per pair (`ReciprocalWebhookStore.findAllBetween`).
- **What it watches:** `registration.reciprocalRegistration` — the *peer's registration of the inviter*, i.e. a resource in the **peer's registry**.
- **What fires it:** when the peer's system PATCHes its registration of the inviter (e.g. sets an access need group, or `replaceDataGrantsOnRegistration` updates `hasDataGrant`).
- **Effect:** `ReciprocalWebhookHandler` PUTs a `delegatedGrantsUpdated` activity → outbox → `updateDelegatedGrants` regenerates the inviter's grants for the scope where the peer is data owner.

**Polarity asymmetry (key property):** subscription ownership is determined by *who initiated the invitation* in each pair, with one webhook per pair pointing from the peer's registry to the inviter's stack:

- A invites B → A's stack owns the edge watching **B's registration of A**. Fires when B changes her registration of A.
- Only the *other* polarity (B invites A, or mutual invites) gives **B's stack** an edge watching **A's registration of B**.

There is no code path that creates the symmetric second edge on the invitee side (`acceptInvitation` RPC only links the reciprocal registration; it never subscribes).

**A second, non-reciprocal push edge — the org activity-registry admin channel
(org context, Phase 3).** An admin of an org subscribes to the org's
**Activity Registry container** with a `WebhookChannel2023` whose `sendTo`
reaches the admin's own `ActivityWebhookHandler`. Unlike the reciprocal
webhook this is a **container-level** subscription (every `Add` on the org's
activity outbox, not a per-registration `Update`) and is **not**
invitation-polarity-dependent: one channel per (admin, org), created with the
admin-grant lifecycle. The same handler serves both edge kinds, discriminated
by whether the channel's webId owns the topic
(`session.registrySet.hasActivityRegistry?.id === channel.topic`): the org's
owner channel (also subscribed) forwards + dispatches workflows; the admin
channel **forwards only**, keyed by the admin's webId — so org-context
`pending`/`done` reach the admin's UI stream (R3 of `org-admin-feature.md`
§3; runtime channel lifecycle in `webhook-subscription-bootstrap.md` §4.6).

## 3. Tier 2 — request/response endpoints

| Endpoint | Handler | Direction | Purpose |
|---|---|---|---|
| `POST /.sai/invitations/<base64(webId)>.<uuid>` | `InvitationHandler` | invitee → inviter | bootstrap: register the invitee, write `agentRegistrationAdded` (which then creates the Tier-1 edge) |
| `POST /.sai/grants/<base64(dataOwner)>` | `GrantIssuanceHandler` | **grantedBy → dataOwner** | delegated-grant issuance; validates a delegable grant (SPARQL), stores grant + ACR in the data owner's registry, runs `storeGrant` (exempt — bypasses the outbox) |
| `GET/HEAD /.sai/agents/<base64(webId)>` | `AgentIdHandler` | any peer → us | authorization-agent client-id document (`hasAuthorizationRedirectEndpoint`, `hasDelegationIssuanceEndpoint`); used by `discoverAuthorizationAgent` / `discoverAgentRegistration`. For an **admin** of the org whose doc is requested (a non-owner requester whose social-agent registration carries the `hasAdminGrant` marker), the response also carries `Link: <org registry set>; rel="interop:hasRegistrySet"` — the header is evaluated against the request credentials, so it stays admin-only while the body stays public (§7) |

## 4. Tier 3 — authenticated pod accesses

Carried by the agent's session (`session.fetch`) directly against the peer's CSS — no endpoint of ours involved:

- `discoverReciprocal` — reads the peer's webId doc → their UAS → their registration of us.
- `createAcr` — HEADs the grant resource on the data owner's storage, PUTs the ACR (permission document) onto the **data owner's pod**.
- Label/profile/grant reads — `webIdProfile(ownerIri)`, `getDataGrants` on reciprocal registrations, etc.

## 5. Three-party delegation chain (dataOwner ≠ grantedBy ≠ grantee)

Alice (dataOwner) → Bob (grantedBy) → Charlie (grantee). All are registered pairs.

### Edge inventory

| Edge | Connection | Direction | Live in current code? |
|---|---|---|---|
| (B, A) | **delegation issuance** (request/response) | **Bob's stack → Alice's `GrantIssuanceHandler`** (`requestDelegation` executes with `grantedBy`'s session, `temporal/activities/grants.ts`) | always, at grant time |
| (A, pod) | grant + ACR physical writes | Alice's own session on her registry/storage | always, via `storeGrant` |
| (B, C) | reciprocal webhook on Bob's registration of Charlie | Bob's registry → Charlie's stack | **only if Charlie was the inviter** (polarity) |
| (B, C) | reciprocal webhook on Charlie's registration of Bob | Charlie's registry → Bob's stack | the common single-invitation case |
| (C → B) | registration PATCH visibility (read) | Charlie's UI reads Bob's registration of Charlie back via the reciprocal link (`getDataGrantIris(reciprocalReg)`) | always — read, not push |

### The grantee-visibility gap

After Bob's `createGrantsForAgent` regenerates Charlie's grants, it PATCHes `hasDataGrant` on **Bob's registration of Charlie** (`replaceDataGrantsOnRegistration`). This is exactly the write Charlie's UI needs to hear (her `getSocialAgents` shows grants by reading that resource through the reciprocal link). Whether Charlie receives a live event depends on **who invited whom** in the (Bob, Charlie) pair — i.e. on whether Charlie's stack owns the edge watching Bob's registration of Charlie — not on the delegation relationship. If Bob invited Charlie, the PATCH is heard by nobody and Charlie's UI falls back to mount/reconnect refetches.

## 6. Asymmetries / gaps (accepted or open)

1. **Webhook polarity ≠ delegation topology.** Edge direction is set by invitation initiator; delegation scenarios expect it to follow the grantor/grantee relationship. Symmetric subscription creation (grantee side subscribing to the grantor's registration of it) or activity emission from the registration PATCH itself would close the grantee-visibility gap.
2. **`GrantIssuanceHandler` bypasses the outbox** — the data-owner side of the delegation edge starts `storeGrant` directly (exempt, row 6 of the decoupling table); no activity is written, so the data owner's UI gets no `pending`/`done` event for incoming delegated grants (mount refetch only).
3. **Directional reads only** — Tier-3 accesses have no notification counterpart; only the Tier-1 edge flows into the activity state machine.
4. Two-directional social edges exist only when both sides invited each other; otherwise the pair has a single one-directional webhook.

## 7. Org ↔ admin (org context)

An administered org is a special peer the user acts *for*: the admin performs
Tier-3 reads/writes against the **org's** registries with their own UAS, but
the **org** is the data owner (C1) — the admin is *a client of another peer's
registries*, not the owner of the registries it mutates.

| Edge | Connection | Direction | Notes |
|---|---|---|---|
| (admin, org) | agent-id discovery (Tier 2, §3) | admin → org's `AgentIdHandler` | non-owner requester with the admin marker gets the `hasRegistrySet` Link header (the org's RegistrySet IRI) |
| (admin, org) | org Activity-Registry webhook (Tier 1, §2) | org's registry → admin's `ActivityWebhookHandler` | forward-only admin channel; events keyed by the admin's webId |
| (admin, org) | Tier-3 reads/writes on the org's registries | admin's UAS session, **org** as data owner | admitted by the org's `#fullAdminAccess` ACP matchers (rewritten from the admin list) |

**Federated nuance.** The org's authorization agent may live on a **different
server** than the admin's: the org's AA serves the agent-id doc (with the
admin-only `hasRegistrySet` link) and runs the org's Activity Registry and its
Temporal workflows; the admin channel's `sendTo` points at the **admin's own**
server. The registry-set header therefore carries the authoritative org
RegistrySet IRI across servers, and org-context events are delivered to the
admin's server keyed under the admin's webId.
