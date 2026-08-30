# LikeC4 conventions — `docs/temporal.c4`

Conventions established while working on the invitation views (`invitation`,
`admin-invitation`) and the discovery views. Follow these for any dynamic view.

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