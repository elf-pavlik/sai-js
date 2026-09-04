import { agentId, buildOidcSession, buildSessionManager } from '@elfpavlik/sai-components'
import { getRegistrySetIri } from '@janeirodigital/interop-utils'
import { describe, expect, test } from 'vitest'
import { waitFor } from './util'

/**
 * Phase 2 of org-admin-feature.md — operating in context.
 *
 * Seed (environments/data/registry.trig): Dan is an admin of YoYo — YoYo's
 * registration of Dan (`ph8e70`) carries the `hasAdminGrant` admin marker and
 * YoYo's `.acr` `#fullAdminAccess` matches Dan + his UAS. Runs the
 * real-CSS-delivery path (RPCs via the account cookies, sessions via
 * buildOidcSession / buildSessionManager).
 */

const rpcEndpoint = 'https://auth/.sai/api'

const danId = 'https://id/dan'
// NOTE: the account cookie VALUE is the `accounts/cookies/<value>` key in kv.json,
// NOT the accountId — dan's account is 9f137c45-…, its cookie is 4f8fe6e4-…
const danCookie = 'css-account=4f8fe6e4-4a5a-4318-93f6-d8645778fc28'
const bobId = 'https://id/bob'
const bobCookie = 'css-account=339642f3-f3ee-42e5-85b9-4b1ab6b27ddc'
const aliceId = 'https://id/alice'
const aliceCookie = 'css-account=8187358a-2072-4dce-9c76-24caffcc84a4'
const yoyoId = 'https://id/yoyo'
const yoyoRegistrySet = 'https://registry/yoyo/'

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

/** The RPC must reject (unallowed context / guard) — accepts ProtocolError and Failure shapes. */
async function expectRpcError(payload: unknown, cookie: string): Promise<void> {
  const response = await fetch(rpcEndpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: cookie,
    },
    body: JSON.stringify(payload),
  })
  if (!response.ok) return // server-side error (defect → HTTP error)
  const body = await response.json()
  const result = body[0]
  if (result._tag === 'Success') {
    throw new Error(`expected RPC error, got Success: ${JSON.stringify(result.value)}`)
  }
}

describe('org context — discovery (2.1/2.2)', () => {
  test('personal ListSocialAgents flags the orgs the user administers', async () => {
    const agents = await rpcCall<{ id: string; admin: boolean }[]>(
      rpcPayload({ _tag: 'ListSocialAgents', context: danId }),
      danCookie
    )
    const yoyo = agents.find((agent) => agent.id === yoyoId)
    expect(yoyo).toBeDefined()
    expect(yoyo!.admin).toBe(true)
    // a plain peer is not flagged
    const bob = agents.find((agent) => agent.id === bobId)
    if (bob) expect(bob.admin).toBe(false)
  })

  test('org-context ListSocialAgents reads the org registry directly (admin marker on the org registration)', async () => {
    const agents = await rpcCall<{ id: string; admin: boolean }[]>(
      rpcPayload({ _tag: 'ListSocialAgents', context: yoyoId }),
      danCookie
    )
    const dan = agents.find((agent) => agent.id === danId)
    expect(dan).toBeDefined()
    expect(dan!.admin).toBe(true)
    expect(agents.some((agent) => agent.id === bobId)).toBe(true)
  })
})

describe('org context — registry-set resolution (2.3)', () => {
  test('AgentIdHandler exposes the hasRegistrySet link only to admins', async () => {
    const regSetRel = 'http://www.w3.org/ns/solid/interop#hasRegistrySet'

    const danSession = await buildOidcSession(danId)
    const adminResponse = await danSession.authFetch(agentId(yoyoId), { method: 'HEAD' })
    expect(adminResponse.status).toBe(200)
    expect(getRegistrySetIri(adminResponse.headers.get('link') ?? '')).toBe(yoyoRegistrySet)

    const bobSession = await buildOidcSession(bobId)
    const nonAdminResponse = await bobSession.authFetch(agentId(yoyoId), { method: 'HEAD' })
    expect(nonAdminResponse.status).toBe(200)
    const link = nonAdminResponse.headers.get('link') ?? ''
    expect(link).not.toContain(regSetRel)
  })

  test('the admin session resolves the org registry set and can read the org registries', async () => {
    const manager = buildSessionManager()
    const danSession = await manager.getSession(danId)

    const registrySet = await danSession.getRegistrySet(yoyoId)
    expect(registrySet.id).toBe(yoyoRegistrySet)
    expect(registrySet.hasSocialAgentRegistry.id).toBe('https://registry/yoyo/social-agent/')
    expect(registrySet.hasRoleRegistry.id).toBe('https://registry/yoyo/role/')

    // the resolved registry set must be readable with the admin's (authenticated) fetch
    const response = await danSession.fetch(registrySet.hasRoleRegistry.id)
    expect(response.ok).toBe(true)
  })
})

describe('org context — context authorization (2.2)', () => {
  test('an admin can target the org context; a non-admin is rejected', async () => {
    const roles = await rpcCall<unknown[]>(
      rpcPayload({ _tag: 'ListRoles', context: yoyoId }),
      danCookie
    )
    expect(Array.isArray(roles)).toBe(true)

    await expectRpcError(rpcPayload({ _tag: 'ListRoles', context: yoyoId }), bobCookie)
    await expectRpcError(rpcPayload({ _tag: 'ListRoles', context: yoyoId }), aliceCookie)
  })

  test('the personal context is always allowed', async () => {
    const agents = await rpcCall<unknown[]>(
      rpcPayload({ _tag: 'ListSocialAgents', context: bobId }),
      bobCookie
    )
    expect(Array.isArray(agents)).toBe(true)
  })
})

describe('org context — owner identity (2.4)', () => {
  test('a role created in the org context lands in the org registry with the org as owner', async () => {
    const role = await rpcCall<{ id: string; label: string; members: string[] }>(
      rpcPayload({
        _tag: 'CreateRole',
        label: 'YoYo Ops',
        members: [],
        context: yoyoId,
      }),
      danCookie
    )
    expect(role.id).toMatch('https://registry/yoyo/role/')

    // readable back through YoYo's own server-side session → the write targeted
    // the org's registry, authenticated by Dan's UAS (fullAdminAccess)
    const manager = buildSessionManager()
    const yoyoSession = await manager.getSession(yoyoId)
    const found = await yoyoSession.findRole(role.id)
    expect(found).toBeDefined()
    expect(found!.label).toBe('YoYo Ops')
  })
})

/** YoYo's profile of an agent in the org context — the marker is linked by the workflow, so poll. */
async function orgContextAdminFlag(webId: string, cookie: string): Promise<boolean | undefined> {
  const agents = await rpcCall<{ id: string; admin: boolean }[]>(
    rpcPayload({ _tag: 'ListSocialAgents', context: yoyoId }),
    cookie
  )
  return agents.find((agent) => agent.id === webId)?.admin
}

describe('org context — admin gating + last-admin guard (2.2/2.4)', () => {
  test('AddAdmin/RemoveAdmin only succeed for admins of the context org', async () => {
    // non-admin caller is rejected before any mutation
    await expectRpcError(
      rpcPayload({ _tag: 'AddAdmin', webId: bobId, context: yoyoId }),
      bobCookie
    )

    // Dan (admin of YoYo) promotes Bob — activity-first (step 5): the RPC
    // pre-mints the AdminAuthorization id + writes the activity only; the
    // hasAdminGrant marker lands via the workflow
    const promoted = await rpcCall<{ id: string; activityId: string }>(
      rpcPayload({ _tag: 'AddAdmin', webId: bobId, context: yoyoId }),
      danCookie
    )
    expect(promoted.activityId).toEqual(expect.any(String))
    await waitFor(async () => (await orgContextAdminFlag(bobId, danCookie)) === true, {
      timeout: 20_000,
    })

    // ...and demotes him again
    const demoted = await rpcCall<{ id: string; admin: boolean }>(
      rpcPayload({ _tag: 'RemoveAdmin', webId: bobId, context: yoyoId }),
      danCookie
    )
    expect(demoted.id).toBe(bobId)
    await waitFor(async () => (await orgContextAdminFlag(bobId, danCookie)) === false, {
      timeout: 20_000,
    })
  })

  test('the last admin cannot be removed', async () => {
    await expectRpcError(
      rpcPayload({ _tag: 'RemoveAdmin', webId: danId, context: yoyoId }),
      danCookie
    )
  })
})

/**
 * org-context-proxy.md — peer-data read plane via `/.sai/proxy-admin` and
 * the registry plane via `/.sai/sparql-admin` (last step).
 *
 * Seed (environments/data/registry.trig): Bob granted YoYo a data grant
 * (`registry/bob/grant/t2v9cd`, AllFromRegistry over
 * `data/bob/avn9hv/` — instances `n3onkx`/"Neon" and `gl1tch`/"Glitch"),
 * linked from Bob's registration of YoYo (`n4m8qx`) — the reciprocal of
 * YoYo's registration of Bob (`z3k7wm`).
 */
describe('org context — peers’ granted data via the proxy (org-context-proxy.md)', () => {
  const bobDataRegistration = 'https://data/bob/avn9hv/'
  const bobNeon = 'https://data/bob/avn9hv/n3onkx'
  const bobGlitch = 'https://data/bob/avn9hv/gl1tch'
  const projectShapeTree = 'https://data/shapetrees/trees/Project'
  const taskShapeTree = 'https://data/shapetrees/trees/Task'

  const proxyAdminUrl = (orgWebId: string, target?: string) =>
    `https://auth/.sai/proxy-admin/${Buffer.from(orgWebId).toString('base64url')}` +
    (target ? `?iri=${encodeURIComponent(target)}` : '')

  test('ListDataRegistries (peer branch) lists the peer registration the org is granted', async () => {
    const registries = await rpcCall<
      { id: string; registrations: { id: string }[] }[]
    >(rpcPayload({ _tag: 'ListDataRegistries', agentId: bobId, lang: 'en', context: yoyoId }), danCookie)
    const bobRegistry = registries.find((registry) => registry.id === 'https://data/bob/')
    expect(bobRegistry).toBeDefined()
    expect(bobRegistry!.registrations.map((registration) => registration.id)).toContain(
      bobDataRegistration
    )
  })

  test('ListDataInstances on the peer’s granted registration lists the instances (labels)', async () => {
    const instances = await rpcCall<{ id: string; label?: string }[]>(
      rpcPayload({
        _tag: 'ListDataInstances',
        agentId: bobId,
        registrationId: bobDataRegistration,
        context: yoyoId,
      }),
      danCookie
    )
    expect(instances).toHaveLength(2)
    expect(instances.map((instance) => instance.id)).toEqual(
      expect.arrayContaining([bobGlitch, bobNeon])
    )
    expect(instances.find((instance) => instance.id === bobNeon)?.label).toBe('Neon')
    expect(instances.find((instance) => instance.id === bobGlitch)?.label).toBe('Glitch')
  })

  test('GetAuthoriaztionData AllFromRegistry count == the registration’s contains (was 0 before the fix)', async () => {
    const data = await rpcCall<{
      dataOwners: {
        id: string
        dataRegistrations: { id: string; count: number }[]
      }[]
    }>(
      rpcPayload({
        _tag: 'GetAuthoriaztionData',
        agentId: bobId,
        agentType: 'http://www.w3.org/ns/solid/interop#SocialAgent',
        lang: 'en',
        context: yoyoId,
      }),
      danCookie
    )
    const bob = data.dataOwners.find((owner) => owner.id === bobId)
    expect(bob).toBeDefined()
    // parity: 2 seeded instances in avn9hv, resolved through /proxy-admin
    expect(bob!.dataRegistrations.find((registration) => registration.id === bobDataRegistration)?.count).toBe(2)
  })

  test('GetResource on the peer-granted instance returns the full body', async () => {
    const resource = await rpcCall<{
      id: string
      label?: string
      shapeTree: { id: string }
      accessGrantedTo: string[]
      children: { shapeTree: { id: string }; count: number }[]
    }>(
      rpcPayload({ _tag: 'GetResource', id: bobNeon, lang: 'en', context: yoyoId }),
      danCookie
    )
    expect(resource.id).toBe(bobNeon)
    expect(resource.label).toBe('Neon')
    expect(resource.shapeTree.id).toBe(projectShapeTree)
    // the org recorded no authorizations over Bob's data → empty access list
    expect(resource.accessGrantedTo).toEqual([])
    // Project references several shape trees (Image, Task, …) — find by id
    const taskChild = resource.children.find((child) => child.shapeTree.id === taskShapeTree)
    expect(taskChild?.count).toBe(2)
  })

  test('GET /proxy-admin as the org admin serves the granted peer registration (JSON-LD)', async () => {
    const danSession = await buildOidcSession(danId)
    const response = await danSession.authFetch(proxyAdminUrl(yoyoId, bobDataRegistration))
    const raw = await response.text()
    expect(response.status, raw.slice(0, 300)).toBe(200)
    expect(response.headers.get('content-type')).toContain('application/ld+json')
    // the data server serves the container in expanded/array JSON-LD form —
    // assert the document contains the registration and its member
    expect(raw).toContain(bobDataRegistration)
    expect(raw).toContain('n3onkx')
  })

  test('non-admin / unknown org cannot use /proxy-admin (403)', async () => {
    const bobSession = await buildOidcSession(bobId)
    const nonAdmin = await bobSession.authFetch(proxyAdminUrl(yoyoId, bobDataRegistration))
    expect(nonAdmin.status).toBe(403)

    const danSession = await buildOidcSession(danId)
    const unknownOrg = await danSession.authFetch(
      proxyAdminUrl('https://id/nonexistent-org')
    )
    expect(unknownOrg.status).toBe(403)
  })

  test('non-GET and malformed iri are rejected (400)', async () => {
    const danSession = await buildOidcSession(danId)
    // CSS aggregates router rejection into a 400: "POST is not allowed" —
    // not a 405 (the error handler combines handler errors as BadRequest).
    const post = await danSession.authFetch(proxyAdminUrl(yoyoId, bobDataRegistration), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    })
    const postBody = await post.text()
    expect(post.status, postBody.slice(0, 300)).toBe(400)
    expect(postBody).toContain('POST is not allowed')

    const missing = await danSession.authFetch(proxyAdminUrl(yoyoId))
    const missingBody = await missing.text()
    expect(missing.status, missingBody.slice(0, 300)).toBe(400)
    expect(missingBody).toContain('missing iri query parameter')

    const relative = await danSession.authFetch(proxyAdminUrl(yoyoId, 'relative/path'))
    expect(relative.status).toBe(400)

    const nonHttp = await danSession.authFetch(proxyAdminUrl(yoyoId, 'file:///tmp/x.ldjson'))
    expect(nonHttp.status).toBe(400)
  })
})
