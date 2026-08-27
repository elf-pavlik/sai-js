# Test isolation & race prevention measures

How the `/test` suite (dagger, vitest `--no-file-parallelism`) keeps tests isolated
and serializes the async workflow machinery, and the residual limits.

## Isolation base

- **Sequential execution** — `dagger:test` runs vitest `--no-file-parallelism`;
  one test file at a time in the test container. Files still share the
  long-lived services (auth/registry/data/worker/temporal/sparql/garage).
- **Per-test seed reload** — `test/setup.ts` `beforeEach` re-seeds the store
  (`pg.seedKeyValue` for the kv store + `seedQuadstore` of `registry.trig` at
  `http://sparql/store`) before **every** test. Leftover state *and* pending
  activities from a previous test are wiped; each test starts from the
  pristine seed (so the seeded role authorization `t1u13z` is always present —
  which makes within-test replacement races deterministic, see below).
- **Temporal retries off** — `temporal/dynamicconfig/development-sql.yaml`
  sets `history.defaultActivityRetryPolicy: maximumAttempts: 1`; workflows are
  started without a retry policy. Failures are one-shot (no retry loops/backlog);
  only the reciprocal/mirror activities in `reciprocal.ts` override with their
  own policies (10/5 attempts).

## Race prevention (test/util.ts + test wiring)

- **`waitForQuiescence(webIds)`** — waits until none of the webIds has
  *pending activities* (registry entries without a matching
  `activityCompleted`) for two consecutive polls. A pending activity ⇔ a
  webhook-triggered workflow is still mid-flight. Wired as `beforeEach` in
  `roles.test.ts` (file agents) so the next test starts only after earlier
  tests' workflows have drained. Long-lived grantee-consumers don't block
  (they carry no pending activities between drains). Sessions are created once
  and reused across polls.
- **`awaitGrantCompletion(authFetch, registrationId, webIds, trigger)`** — the
  shared barrier for grant-affecting changes:
  1. opens the registration's notification stream **before** the trigger
     (listen-first; no events missed while the workflow runs),
  2. runs the trigger (one RPC),
  3. awaits the registration `Update`,
  4. **then waits for quiescence over the webIds** — the `Update` fires
     *mid-chain* (registration PATCH inside a child workflow) while the parent
     workflow's `activityCompleted` write (its tail) is still pending;
     returning on the `Update` alone lets the *next* write race that tail in
     the same activity container (CSS SPARQL-backend concurrent-write
     corruption). Waiting for full completion closes the gap.
- **One RPC per barrier** — triggers are split so each test's own async chains
  don't overlap: `roles.test.ts` "create authorization for role with existing
  members" issues `UpdateRole` and `AuthorizeApp` in separate
  `awaitGrantCompletion` steps, since both chains touch the same seeded
  authorization (the second's replacement deletes `t1u13z` while the first's
  workflow is still fetching it).

## Residual limits (known)

- The measures serialize and wait — they do **not** fix product-side
  races: a workflow iterating authorizations still 404s on a
  just-replaced/deleted authorization (stale `ldp:contains` after
  `replaceDataAuthorizationsForGrantee`; CSS SPARQL-backend
  `dcterms:modified` metadata corruption). Iterators
  (`findAuthorizationsForAgent`, `dataAuthorizations`) have no 404/410
  tolerance yet — tracked (`docs/plans/improve-fetch-json-ld.md`).
- Ambient environment noise observed under load (owner-read 403s, empty webid
  docs, `OwnerPermissionReader "Unable to find pod"`) is not addressed by the
  harness; believed store/ACL inconsistency, not test ordering (some fail only
  whole-file, pass solo).
- `awaitNotification` has no internal timeout (vitest's default 25s caps it);
  `waitForQuiescence` defaults to 30s — a never-completing chain surfaces as a
  test timeout rather than the quiescence error.