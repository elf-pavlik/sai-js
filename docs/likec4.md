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
- **Mirrored include ordering (two-party views).** The invitation-pair views
  list the parties' components as mirror images around the center: party 1
  forward (`AUI, UAS, ActivityWebhookHandler, Registry, Temporal, Worker`),
  party 2 reversed (`Worker, Temporal, ActivityWebhookHandler, Registry, UAS,
  AUI`):

  ```c4
  include Kim, Dan
  include Kim.AUI, Kim.UAS, Kim.ActivityWebhookHandler, Kim.Temporal, Kim.Registry, Kim.Worker, Dan.Worker, Dan.Registry, Dan.Temporal, Dan.ActivityWebhookHandler, Dan.UAS, Dan.AUI
  ```

  `org-admin-add-personal` follows the same mirror — Alice's components are
  the reverse of Kim's; her `WebhookReceiver` is appended as the inbound edge
  (the invitation views have no receiver component to pattern after).
- **Two peers + a third admin — less clear (⚠️ admin includes to be
  finalized).** In `admin-invitation-send` / `admin-invitation-receive` the
  first peer (Kim) stays forward and the middle party (YoYo, an org — no
  `AUI`) is reversed (`YoYo.Worker, YoYo.Registry, YoYo.Temporal,
  YoYo.ActivityWebhookHandler, YoYo.UAS`), but the third party (Dan, the
  admin) is NOT mirrored — his subset is `Dan.AUI, Dan.ActivityWebhookHandler,
  Dan.UAS`. No firm rule yet for the admin section in admin-heavy views; treat
  the admin include ordering as **to be finalized** until those views settle
  one.
- Colors: `green` inviter/org owner, `indigo` admin, `sky` acceptor/peer.

## Notes & callouts

- The notes of a step open with an **h4 header that repeats the relationship
  title**, then the callouts:

  ```markdown
  #### POST (RPC) createInvitation
  >[!NOTE]
  >invitation.test.ts > personal
  ```

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
- Responses directly after a request are **not** separate arrows: put the
  response `http` (+ payload) blocks at the **bottom of the request step**,
  separated by a `---` line. Non-adjacent responses stay as steps.

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

- **Flow-control blocks (`alt` / `when` / `if` / `else`) need likec4 ≥ 1.53.**
  The workspace `package.json` pins `^1.42.1` (resolves to 1.48.0), whose
  grammar does NOT recognize `alt`/`when`/`if` — it parses `alt` as an
  element reference (`Could not resolve reference to Referenceable named
  'alt'`). Until the dependency is bumped, run the version explicitly from
  the repo root: `npx --yes likec4@latest validate --file docs/temporal.c4 .`
  (also `… start`), and use the same version for validation as for the
  dev server.

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

## View coverage per social agent (17 dynamic views)

Party-level `include` per view (recomputed when views change — `grep '^    include'`
inside each `dynamic view` block and map the dot-less tokens onto the model
securities). **Kim appears in the fewest diagrams (5); Alice in the most (8).**

| Social agent | Count | Diagrams |
|---|---|---|
| **Kim** | 5 | `org-admin-add-personal`, `org-admin-remove-personal`, `invitation`, `admin-invitation-send`, `admin-invitation-receive` |
| **YoYo** (org) | 5 | `org-registry-set-discovery`, `org-admin-add`, `org-admin-remove`, `admin-invitation-send`, `admin-invitation-receive` |
| **Dan** | 6 | `org-registry-set-discovery`, `org-admin-add`, `org-admin-remove`, `invitation`, `admin-invitation-send`, `admin-invitation-receive` |
| **Bob** | 7 | `social-agent-registration-discovery`, `org-registry-set-discovery`, `org-admin-add`, `org-admin-remove`, `authorization`, `role-deletion`, `request-access` |
| **Alice** | 8 | `reciprocal-registration-update`, `application-registration-discovery`, `social-agent-registration-discovery`, `org-admin-add-personal`, `org-admin-remove-personal`, `authorization-data-app`, `role-membership-change`, `request-access` |

Non-agent parties for reference: `App` 3 (`application-registration-discovery`,
`authorization-data-app`, `authorization`), `ACME` 1
(`reciprocal-registration-update`), `Common` 1 (`authorization-data-app`);
`Others` / `Peers` appear in no view.
