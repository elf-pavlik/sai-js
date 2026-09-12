import { buildSessionManager } from '@elfpavlik/sai-components'
import { ActivityRegistry } from '@janeirodigital/interop-authorization-agent'
import { loadGrant } from '@janeirodigital/interop-data-model'
import { INTEROP, LDP, getAcl, linkedIrisJsonLd, parseTurtle } from '@janeirodigital/interop-utils'
import { describe, expect, test } from 'vitest'
import { awaitEvent, openEventsStream } from './util'

/**
 * Phase 5 of org-admin-feature.md — personal-context add/remove: a REGULAR
 * user (no org, no admin marker anywhere) promotes/demotes their OWN admins.
 *
 * Seed (environments/data/registry.trig): Kim's registry set
 * (`https://registry/kim/`) holds a registration of Alice (`plp3a3`, the
 * reciprocal of Alice's registration of Kim `fpn3ih`); Kim's `.acr` carries
 * only `#fullOwnerAccess` (no `#fullAdminAccess` — the runtime rewrite must
 * add it AND wire it into `#root`). Kim's personal Activity Registry channel
 * (`kv.json` `**activityWebhook**` for kim) is her OWNER channel — it
 * dispatches the admin workflows and forwards pending/done to her stream.
 *
 * features.md §4: `AddAdmin`/`RemoveAdmin` run by the **data owner** in a
 * personal context — the personal context passes `resolveContext` without any
 * admin marker. Differences from the org path:
 * - the LAST-ADMIN guard is skipped at RPC time (the owner remains the
 *   operator after demoting their only admin);
 * - `syncAdminAcr` handles the empty admin list — the demotion removes the
 *   `#fullAdminAccess` access control entirely (zero admins → zero admin
 *   access), instead of refusing and leaving the activity pending.
 */

const rpcEndpoint = 'https://auth/.sai/api'

const kimId = 'https://id/kim'
const kimCookie = 'css-account=77b0674a-1f3b-4c78-a7d9-0b2e3f4a5b6c'
const aliceId = 'https://id/alice'
const aliceCookie = 'css-account=8187358a-2072-4dce-9c76-24caffcc84a4'

function rpcPayload(request: unknown) {
  return [
    {
      request,
      headers: {},
      traceId: '13c2035f72f45c1ebbf13b055b7dc526',
      spanId: '685581075752b8a2',
      sampled: true,
    },
  ]
}

/** Resolve a RPC to its value; any non-Success outcome throws with the body. */
async function rpcCall<T>(payload: unknown, cookie: string): Promise<T> {
  const response = await fetch(rpcEndpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: cookie,
    },
    body: JSON.stringify(payload),
  })
  if (!response.ok) {
    throw new Error(`RPC failed with ${response.status}: ${await response.text()}`)
  }
  const body = await response.json()
  const result = body[0]
  if (result._tag !== 'Success') {
    throw new Error(`RPC failed: ${JSON.stringify(result)}`)
  }
  return result.value as T
}

/** The registry owner an activity belongs to — its actor (as:actor, plain IRI). */
function activityOwner(activity: { actor?: string }): string | undefined {
  return activity.actor
}

const acp = {
  AccessControl: 'http://www.w3.org/ns/solid/acp#AccessControl',
  apply: 'http://www.w3.org/ns/solid/acp#apply',
  anyOf: 'http://www.w3.org/ns/solid/acp#anyOf',
  agent: 'http://www.w3.org/ns/solid/acp#agent',
}

/** HEAD the registry set for its ACR and fetch it as the webid — 4xx fails the test. */
async function fetchRegistrySetAcr(webId: string): Promise<{ acrId: string; turtle: string }> {
  const manager = buildSessionManager()
  const session = await manager.getSession(webId)
  const headResponse = await session.fetch(session.registrySet.id, { method: 'HEAD' })
  const acrId = getAcl(headResponse.headers.get('link') ?? '')
  if (!acrId) throw new Error(`no acl link on registry set: ${session.registrySet.id}`)
  const response = await session.fetch(acrId, { headers: { Accept: 'text/turtle' } })
  expect(response.ok).toBe(true)
  return { acrId, turtle: await response.text() }
}

/** `acp:agent` values of every matcher under the registry set's `#fullAdminAccess`. */
async function fullAdminAccessAgents(webId: string): Promise<string[]> {
  const { acrId, turtle } = await fetchRegistrySetAcr(webId)
  const store = await parseTurtle(turtle, acrId)
  const policies = new Set<string>()
  const matchers = new Set<string>()
  for (const quad of store) {
    if (quad.predicate.value === acp.apply && quad.subject.value.endsWith('#fullAdminAccess')) {
      policies.add(quad.object.value)
    }
  }
  for (const quad of store) {
    if (policies.has(quad.subject.value) && quad.predicate.value === acp.anyOf) {
      matchers.add(quad.object.value)
    }
  }
  const agents: string[] = []
  for (const quad of store) {
    if (matchers.has(quad.subject.value) && quad.predicate.value === acp.agent) {
      agents.push(quad.object.value)
    }
  }
  return [...new Set(agents)]
}

/** `target`s of every completion in the webId's Activity Registry. */
async function completedActivityTargets(webId: string): Promise<string[]> {
  const manager = buildSessionManager()
  const session = await manager.getSession(webId)
  return ActivityRegistry.getCompletedActivityIris(
    session.registrySet.hasActivityRegistry,
    session.fetch
  )
}

/** AdminGrant IRIs in the webId's GrantRegistry for the given grantee. */
async function adminGrantIris(webId: string, grantee: string): Promise<string[]> {
  const manager = buildSessionManager()
  const session = await manager.getSession(webId)
  const registry = session.registrySet.hasGrantRegistry
  const iris = await linkedIrisJsonLd(registry.id, session.fetch, LDP.contains)
  const adminGrants: string[] = []
  for (const iri of iris) {
    const grant = await loadGrant(iri, session.fetch)
    if (grant.type.includes(INTEROP.AdminGrant) && grant.grantee === grantee) {
      adminGrants.push(iri)
    }
  }
  return adminGrants
}

describe('personal context — Kim makes Alice her admin (phase 5, regular user)', () => {
  test('AddAdmin in the personal context materializes the AA, grants, marker and ACR', async () => {
    // listen first — the server never replays
    const stream = await openEventsStream(kimCookie)

    // Kim is a REGULAR user — no org, no admin marker; she promotes Alice as
    // the data owner of her own registry set (features.md §4). The RPC
    // pre-mints the AdminAuthorization id + writes the activity only; the
    // workflow PUTs the resource, runs grants/ACR (step 5).
    const promoted = await rpcCall<{ id: string }>(
      rpcPayload({ _tag: 'AddAdmin', webId: aliceId, context: kimId }),
      kimCookie
    )
    expect(promoted.id).toMatch('https://registry/kim/authorization/')
    expect(promoted.activityId).toEqual(expect.any(String))

    const pending = await awaitEvent(
      stream,
      (message) =>
        message.type === 'activity' &&
        message.activity?.type?.includes('AdminAuthorizationGranted') &&
        message.activity.status === 'pending',
      { close: false }
    )
    expect(pending).toBeDefined()
    expect(activityOwner(pending!.activity)).toBe(kimId)

    const done = await awaitEvent(
      stream,
      (message) =>
        message.type === 'activity' &&
        message.activity?.id === pending?.activity.id &&
        message.activity.status === 'done'
    )
    expect(done).toBeDefined()

    // the AdminAuthorization lives in Kim's AuthorizationRegistry
    const manager = buildSessionManager()
    const kimSession = await manager.getSession(kimId)
    const authorization = await kimSession.findAdminAuthorization(aliceId)
    expect(authorization).toBeDefined()
    expect(authorization!.grantedBy).toBe(kimId)

    // one RegistrySet-scoped grant + one Read-only DataRegistry-scoped grant
    // per data registry (kim-red, kim-blue)
    expect(await adminGrantIris(kimId, aliceId)).toHaveLength(3)

    // the direct marker lands on Kim's registration of Alice
    const registration = await kimSession.findSocialAgentRegistration(aliceId)
    expect(registration?.hasAdminGrant ?? []).toHaveLength(1)

    // the personal .acr gained a #fullAdminAccess wired under #root (the seed
    // carried none — the rewrite adds both the control AND the wiring)
    expect(await fullAdminAccessAgents(kimId)).toEqual([aliceId])

    // the personal ListSocialAgents now flags Alice with the DIRECT `admin`
    // marker (the toggle-admin state) — while the reciprocal `adminOf` stays
    // off (Alice never made Kim HER admin)
    const agents = await rpcCall<{ id: string; admin: boolean; adminOf: boolean }[]>(
      rpcPayload({ _tag: 'ListSocialAgents', context: kimId }),
      kimCookie
    )
    const alice = agents.find((agent) => agent.id === aliceId)
    expect(alice?.admin).toBe(true)
    expect(alice?.adminOf).toBe(false)
  })

  test('RemoveAdmin demotes the only admin — the owner remains (no last-admin lockout)', async () => {
    // promote first (Alice is the ONLY AdminAuthorization afterwards)
    const stream = await openEventsStream(kimCookie)
    await rpcCall<{ id: string }>(
      rpcPayload({ _tag: 'AddAdmin', webId: aliceId, context: kimId }),
      kimCookie
    )
    const addPending = await awaitEvent(
      stream,
      (message) =>
        message.type === 'activity' &&
        message.activity?.type?.includes('AdminAuthorizationGranted') &&
        message.activity.status === 'pending',
      { close: false }
    )
    expect(addPending).toBeDefined()
    await awaitEvent(
      stream,
      (message) =>
        message.type === 'activity' &&
        message.activity?.id === addPending?.activity.id &&
        message.activity.status === 'done'
    )

    // Kim demotes her ONLY admin — the last-admin guard is skipped in the
    // personal context (the owner remains the operator; org contexts keep the
    // guard). activity-first step 6: the ack echoes the revoked AA id.
    const stream2 = await openEventsStream(kimCookie)
    const demoted = await rpcCall<{ id: string }>(
      rpcPayload({ _tag: 'RemoveAdmin', webId: aliceId, context: kimId }),
      kimCookie
    )
    expect(demoted.id).toMatch('https://registry/kim/authorization/')
    expect(demoted.activityId).toEqual(expect.any(String))

    const revoked = await awaitEvent(
      stream2,
      (message) =>
        message.type === 'activity' &&
        message.activity?.type?.includes('AdminAuthorizationRevoked') &&
        message.activity.status === 'done'
    )
    expect(revoked).toBeDefined()
    expect(activityOwner(revoked!.activity)).toBe(kimId)

    const manager = buildSessionManager()
    const kimSession = await manager.getSession(kimId)

    // the AdminAuthorization is gone
    expect(await kimSession.findAdminAuthorization(aliceId)).toBeUndefined()
    // the grants are gone
    expect(await adminGrantIris(kimId, aliceId)).toHaveLength(0)
    // the direct marker is unlinked
    const registration = await kimSession.findSocialAgentRegistration(aliceId)
    expect(registration?.hasAdminGrant ?? []).toHaveLength(0)
    // zero admins → zero admin access: the #fullAdminAccess access control is
    // removed ENTIRELY (the empty-admin rewrite, not a refusal)
    expect(await fullAdminAccessAgents(kimId)).toEqual([])
    // exactly one completion — the workflow finished instead of failing
    const targets = await completedActivityTargets(kimId)
    expect(targets.filter((target) => target === revoked!.activity.id)).toHaveLength(1)
  })

  test("Alice's UI learns about the promotion via the reciprocal channel (delegatedGrantsUpdated)", async () => {
    // Alice holds NO channel on Kim's ACTIVITY registry — she learns through
    // her reciprocal webhook on Kim's registration of her (`plp3a3`, seeded in
    // environments/data/kv.json): the hasAdminGrant PATCH fires an `Update` to
    // Alice's ReciprocalWebhookHandler → `delegatedGrantsUpdated` in ALICE's
    // own Activity Registry → her personal owner channel forwards
    // pending/done to her stream and dispatches the mirror workflow
    const stream = await openEventsStream(aliceCookie)

    await rpcCall<{ id: string }>(
      rpcPayload({ _tag: 'AddAdmin', webId: aliceId, context: kimId }),
      kimCookie
    )

    const pending = await awaitEvent(
      stream,
      (message) =>
        message.type === 'activity' &&
        message.activity?.type?.includes('DelegatedGrantsUpdated') &&
        message.activity.status === 'pending',
      { close: false }
    )
    expect(pending).toBeDefined()
    expect(activityOwner(pending!.activity)).toBe(aliceId)
    expect(pending!.activity.target).toBe(kimId)

    const done = await awaitEvent(
      stream,
      (message) =>
        message.type === 'activity' &&
        message.activity?.id === pending?.activity.id &&
        message.activity.status === 'done'
    )
    expect(done).toBeDefined()
  })
})