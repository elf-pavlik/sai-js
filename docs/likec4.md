# LikeC4 conventions — `docs/temporal.c4`

Conventions established while working on the invitation views (`invitation`,
`admin-invitation-send`, `admin-invitation-receive`) and the discovery views. Follow these for any dynamic view.

## Dynamic views & steps

- Flows are **dynamic views**; view ids and `navigateTo` targets are
  **kebab-case** (`social-agent-registration-discovery`, `invitation`).
- Step syntax is `SOURCE -> TARGET 'title'`. **`<->` is not valid in dynamic
  steps** (grammar accepts `<-`, `->`, `-[kind]`, or `.` chains only).
- A `navigateTo <view-id>` on a step renders the drill-down link; pair it with
  a relative markdown link in the note (dev-preview URL pattern):

  ```markdown
  [social-agent-registration-discovery](../social-agent-registration-discovery/?dynamic=sequence)
  ```

- **Never leave unused includes** — every included element is referenced by a
  step or a style.
- Include order: **acceptor first, then the inviter party, then the admin**
  (`Bob, Alice` / `Bob, YoYo, Dan`); per agent the component order is
  `AUI, UAS, Registry, ActivityWebhookHandler, Temporal, Worker`.
- **Mirrored include ordering (two-party views).** The parties' components
  mirror around the **registry seam** — party 1 forward ends with its
  `Registry`, party 2 reversed starts with its `Registry`, so the two
  registries sit next to one another in the center. Forward order:
  `AUI, UAS, UAS.UiApi, UAS.Temporal, UAS.WebhookReceiver, UAS.Discovery,
  Registry` (the `UAS.Discovery` hugs the seam
  Registry); party 2 reversed: `Registry, ActivityWebhookHandler, Worker,
  Temporal, UAS, AUI` (nested peers reverse the forward list exactly:
  `Registry, UAS.Discovery, UAS.WebhookReceiver, UAS.Temporal, UAS.UiApi,
  UAS`, no `AUI` for orgs):

  ```c4
  include Kim, Dan
  include Kim.AUI, Kim.UAS, Kim.UAS.UiApi, Kim.UAS.Temporal, Kim.UAS.WebhookReceiver, Kim.UAS.Discovery, Kim.Registry, Dan.Registry, Dan.UAS.Discovery, Dan.UAS.WebhookReceiver, Dan.UAS.Temporal, Dan.UAS.UiApi, Dan.UAS, Dan.AUI
  ```

  `org-admin-add-personal` follows the same mirror — Alice's components are
  the reverse of Kim's, her `Registry` on the seam next to Kim's; her merged
  `UAS.WebhookReceiver` sits in its mirror position right after the
  `Registry` (on Kim's side the reciprocal `Update` enters the UAS there).
  The `X.UAS` container is
  always included (renders as a box), leaves only when a step references
  them.
- **Two peers + a third admin — less clear (⚠️ admin includes to be
  finalized).** In `admin-invitation-send` / `admin-invitation-receive` the
  first peer (Kim) stays forward and the middle party (YoYo, an org — no
  `AUI`) is reversed (`YoYo.Registry, YoYo.UAS.Discovery,
  YoYo.UAS.WebhookReceiver, YoYo.UAS.Temporal, YoYo.UAS.UiApi, YoYo.UAS`),
  but the third party (Dan, the
  admin) is NOT mirrored and sits to the **right of the org**, with his
  `AUI` at the far right end: `Dan.UAS, Dan.UAS.Discovery,
  Dan.UAS.WebhookReceiver, Dan.UAS.UiApi, Dan.AUI` (container + the leaves
  his steps touch: org registry-set discovery, admin channel forward,
  RPC/events; no Temporal —
  the admin runs no workflows there). In `org-admin-add` / `org-admin-remove`
  the same right-of-org order applies (YoYo section left, Dan section right).
- Colors: `green` inviter/org owner, `indigo` admin, `sky` acceptor/peer.

## Notes & callouts

- The notes of a step open with an **h4 header that repeats the relationship
  title**, then the callouts:

  ```markdown
  #### POST (RPC) createInvitation
  >[!NOTE]
  >invitation.test.ts > personal
  ```

- **Request + response is a single step.** A request and its directly
  following response are **one step** — the response `HTTP/1.1 <status>`
  (+ payload) goes at the bottom of the request step's note, separated from
  the request by a `---` line. This covers RPC calls, webhook acks, and Temporal
  workflow-start acks alike — a bare `X.UAS.Temporal -> X.UAS.WebhookReceiver
  'OK'` arrow is never drawn; the gRPC ack lives inside the `start … workflow`
  step's note. Non-adjacent responses stay as separate steps.

- **Every step** carries a `>[!NOTE]` with `>file > describe` (no `source:`,
  no space after the leading `>`):

  ```
  >[!NOTE]
  >invitation.test.ts > personal
  ```

- **Requests** carry a `>[!IMPORTANT]` naming the acting identity in
  backticks:
  - browser → UAS RPC: `> Auth: CSS cookie session as \`alice\``
  - UAS / worker requests: `> Auth: Solid OIDC access token as \`alice\`` —
    always the **owner of the acting UAS** (the signed-in user's own UAS; in
    org context the org's own session: `as \`yoyo\``, not the admin).
  - webhook delivery: `> Auth: Capability URL`.
- `>[!TIP]` only for genuine patterns: the capabilityUrl formula
  (`https://auth/.sai/invitations/{base64url(webId)}.{uuid}`), `gRPC` for
  Temporal workflow start/run payloads, "Peer WebId from Solid OIDC token in
  POST to capabilityUrl".
- **No stray prose** — everything lives in callouts and code blocks.
- Responses directly after a request are **not** separate arrows (see
  “Request + response is a single step” above): put the response `http`
  (+ payload) blocks at the **bottom of the request step**, separated by a
  `---` line. Non-adjacent responses stay as steps.

## Code blocks

- `http` blocks are **minimal**: request line + auth/type headers only.
  - RPC: `Cookie: css-account=...`
  - UAS requests: `Authorization: DPoP eyJhbGciOiJFUzI1NiIs…` (abbreviated
    token), plus `Content-Type` (`application/sparql-query`,
    `application/sparql-update`, `application/ld+json`) and `Accept`
    (`application/x-ndjson`, `application/ld+json`) where relevant.
- Responses: `HTTP/1.1 <status>` line (+ `Content-Type` when a body follows);
  the body goes in its **own snippet block** (`text/plain` body in a
  `text` block).
- JSON-LD payloads use the compacted form with the expanded-context note:
  `"@context": ["in reality payload uses Expanded JSON-LD"]`.
- **SPARQL**: declare `PREFIX`; write subject / predicate / object each on its
  own line with incremental indentation; terminator `.` on the object line.
- **NDJSON** events stay on one line.
- Long `Link` headers wrap params onto their own lines, indented to align
  under the href:

  ```http
  HTTP/1.1 200 OK
  Link: <https://id/alice>;
        anchor="https://registry/alice/agent/939a58f3-bf2f-48ae-8532-90638e6f36f4/";
        rel="http://www.w3.org/ns/solid/interop#registeredAgent"
  ```

## Payload data

- **Real IDs from tests/seeds** (`test/*.ts`,
  `environments/data/registry.trig`, `environments/data/kv.json`): webIds,
  registries (`https://registry/{handle}/agent/`), cookies
  (`css-account=...`), webhook endpoints (`.../.sai/activity-webhook/<uuid>`,
  `.../.sai/reciprocal-webhook/<uuid>`), account IDs, seeded channel ids.
- Runtime-created resources get **real `crypto.randomUUID()` values**, one per
  resource. The capabilityUrl suffix and the contained resource id are
  **two distinct UUIDs** (two separate `randomUUID()` calls).
- The story is kept consistent across views (same capabilityUrl, invitation
  resource, and IDs chain: registration → activity → activityCompleted →
  Add-notification `object`).
- Intentional doc shortcuts are fine but flagged (e.g. a seeded capabilityUrl
  reused as the "created" invitation's URL in the accept narrative).

## Flow shape (invitation views)

`open notifications stream` (`GET https://auth/.sai/events`,
`Accept: application/x-ndjson`) → **create flow** (RPC → PUT invitation →
PATCH container → RPC OK, with merged 201/200 responses) → `pass link out of
band` (TIP with the capabilityUrl) → **accept flow** → workflow steps
(`gRPC` payload: `accountId`, `webId`, `peerId`, `registrationId`,
`activityIri`) → `activityCompleted` → webhook `notify Add` (Solid
Notifications `Add` JSON-LD) → admin-channel forward → `forward done event`
(single-line NDJSON).
## Tooling — likec4 version

- The workspace `package.json` pins `likec4` at `^1.59.3` (≥ 1.53), so
  flow-control blocks (`alt` / `when` / `if` / `else`) and container-aware
  dynamic steps are supported natively. Validate with the pinned runner from
  the repo root:

  ```bash
  npx likec4 validate --json --no-layout --file docs/temporal.c4 .
  ```

  Use the same version for the dev server (`npx likec4 … start`). The
  `npx --yes likec4@latest` workaround is no longer needed.

## Flow-control conventions (dynamic views)

- Blocks are **containers**: disjoint or properly nested — **no partial
  overlap** (a step belongs to exactly its enclosing blocks; crossing
  fences are structurally impossible).
- `parallel` cannot nest inside `parallel` (the only nesting ban); it may
  live inside `opt`/`loop`/`try`/an `alt` branch.
- `alt` takes **one `else`** (the catch-all — a second `else` is
  grammatically tolerated but dead); branches are `when`/`if` + `else`,
  each with an optional title.
- **Early-return pattern** (used by `request-access`): put the failure
  branch first and the WHOLE follow-up inside `else`:

  ```likec4
  alt {
    if 'validation fails' {
      SOURCE -> TARGET '403 Forbidden'   // flow terminates here
    }
    else 'registered' {
      SOURCE -> TARGET '…'               // the entire success chain
      // (everything downstream lives INSIDE the branch — nothing follows the alt)
    }
  }
  ```

## UAS container — leaves (all agents)

`UAS` is a **container** (non-leaf) whose leaves map onto the UAS HTTP surface
and Temporal. Every agent is restructured — Kim, YoYo (an org — no `AUI`),
Dan, Bob and Alice — the only leaf `UAS` components left belong to the
app-side parties (`App`, `Peers`, `ACME`) and `Others`/`Common`.

The `WebhookReceiver` leaf merges the old `ActivityWebhookHandler` and
(where present) `WebhookReceiver` components; the old `Temporal` + `Worker`
merge into one `Temporal`.

| Leaf | Handles |
|---|---|
| `Discovery` | agent registration discovery (`HEAD /.sai/agents/{base64url(webId)}`, AgentIdHandler) and registry set discovery (admin-gated `Link: rel="interop:hasRegistrySet"` on the same route); for now also the invitation capabilityUrl accept — the peer `POST /.sai/invitations/{base64url(webId)}.{uuid}` plus its handling (`fetch/update Social Agent Invitation`, `PUT agentRegistrationAdded`, `create Social Agent Registration`, `WebId` response) |
| `UiApi` | browser UI RPC (`POST /.sai/api`, cookie session) and the notifications stream (`GET /.sai/events`) |
| `WebhookReceiver` | webhook-driven notifications — `/.sai/activity-webhook/<uuid>` and `/.sai/reciprocal-webhook/<uuid>` (merged activity + reciprocal channels) |
| `Temporal` | Temporal server + worker — workflow start (gRPC), schedule and activity execution |

Include order and model order for a nested UAS:
`X.UAS, X.UAS.UiApi, X.UAS.Temporal, X.UAS.WebhookReceiver, X.UAS.Discovery`
(restructured agents merge `TemporalServer` + `Worker` into one `Temporal`; the
former
server→worker `(workflow) run` steps stay as a self-edge
`X.UAS.Temporal -> X.UAS.Temporal` carrying the gRPC payload — self-steps are
valid in dynamic views. Other agents keep `X.ActivityWebhookHandler,
X.Temporal, X.Worker` until they follow the split), with `X.Registry`
(outside UAS) following the `X.UAS.Discovery` at the invitation mirror
edge.
The container `X.UAS` itself is always included so it renders as the box
around its leaves; a leaf is included only when a step references it.

## Dynamic steps with containers

- Containers are **valid step endpoints**: `Kim.UAS.Discovery -> Kim.Registry`,
  `Kim.AUI -> Kim.UAS.UiApi`, `Kim.UAS.WebhookReceiver -> Kim.UAS.Temporal`
  (siblings under the same container) all validate.
- **Parent ↔ own-child steps are invalid** (`Invalid parent-child
  relationship`): never write `X.UAS -> X.UAS.Worker` as a step. When a `UAS`
  is nested, rewrite every step endpoint that used the container FQN (`X.UAS`)
  to the leaf that serves it: `UiApi` for browser RPC/events and
  capabilityUrl accepts, `Discovery` for agent/registry-set lookups,
  `WebhookReceiver` for webhook deliveries, `Temporal` for
  workflow steps.

## WebhookReceiver step tags

Steps on the merged `X.UAS.WebhookReceiver` carry a bracket tag naming the
channel, in the same style as the resource tags (`[Agent]`, `[Activity]`, …):

- `X.Registry -> X.UAS.WebhookReceiver 'notify Add activity … [Activity]'`
- `X.Registry -> X.UAS.WebhookReceiver 'notify Update … [Reciprocal]'`

No `[Reciprocal]` steps exist yet — reciprocal deliveries appear once peer
agents get the merged receiver (their incoming `Update` notifications land on
the same leaf as activity notifications).

## View coverage per social agent (18 dynamic views)

Party-level `include` per view (recomputed when views change — `grep '^    include'`
inside each `dynamic view` block and map the dot-less tokens onto the model
securities). **Kim appears in the fewest diagrams (5); Alice in the most (10).**

| Social agent | Count | Diagrams |
|---|---|---|
| **Kim** | 5 | `org-admin-add-personal`, `org-admin-remove-personal`, `invitation`, `admin-invitation-send`, `admin-invitation-receive` |
| **YoYo** (org) | 5 | `org-registry-set-discovery`, `org-admin-add`, `org-admin-remove`, `admin-invitation-send`, `admin-invitation-receive` |
| **Dan** | 6 | `org-registry-set-discovery`, `org-admin-add`, `org-admin-remove`, `invitation`, `admin-invitation-send`, `admin-invitation-receive` |
| **Bob** | 7 | `social-agent-registration-discovery`, `org-admin-add`, `org-admin-remove`, `authorization`, `role-deletion`, `request-access`, `authz-data-need-based-request` |
| **Alice** | 10 | `reciprocal-registration-update`, `application-registration-discovery`, `social-agent-registration-discovery`, `org-admin-add-personal`, `org-admin-remove-personal`, `authorization-data-app`, `share-resource`, `role-membership-change`, `request-access`, `authz-data-need-based-request` |

Non-agent parties for reference: `App` 4 (`application-registration-discovery`,
`authorization-data-app`, `authorization`, `share-resource`), `ACME` 1
(`reciprocal-registration-update`), `Common` 2 (`authorization-data-app`,
`authz-data-need-based-request`), `Peers` 1 (`share-resource`); `Others`
appears in no view.
