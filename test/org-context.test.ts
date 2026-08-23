import { agentId, buildOidcSession, buildSessionManager } from '@elfpavlik/sai-components'
import { RoleRegistry } from '@janeirodigital/interop-data-model'
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
    expect(registrySet.hasAgentRegistry.id).toBe('https://registry/yoyo/agent/')
    expect(registrySet.hasRoleRegistry.id).toBe('https://registry/yoyo/role/')

    // the resolved registry set must be readable with the admin's (authenticated) fetch
    const roles = []
    for await (const role of RoleRegistry.roles(registrySet.hasRoleRegistry, danSession.factory)) {
      roles.push(role)
    }
    expect(Array.isArray(roles)).toBe(true)
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
    expect(found!.prefLabel).toBe('YoYo Ops')
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

    // Dan (admin of YoYo) promotes Bob — the RPC records the AdminAuthorization
    // synchronously; the hasAdminGrant marker lands via the workflow
    const promoted = await rpcCall<{ id: string; admin: boolean }>(
      rpcPayload({ _tag: 'AddAdmin', webId: bobId, context: yoyoId }),
      danCookie
    )
    expect(promoted.id).toBe(bobId)
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