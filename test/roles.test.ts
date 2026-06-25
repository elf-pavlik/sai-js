import { buildSessionManager } from '@elfpavlik/sai-components'
import { describe, expect, test } from 'vitest'

const rpcEndpoint = 'https://auth/.sai/api'

async function verifyAccessGrant(
  kimId: string,
  aliceId: string,
  projectShapeTree: string,
  expectGrant: boolean
) {
  const manager = buildSessionManager()
  const kimSession = await manager.getSession(kimId)

  const kimRegForAlice = await kimSession.findSocialAgentRegistration(aliceId)
  expect(kimRegForAlice).toBeDefined()
  expect(kimRegForAlice!.registeredAgent).toBe(aliceId)

  const aliceRegForKim = kimRegForAlice!.reciprocalRegistration
  expect(aliceRegForKim).toBeDefined()
  expect(aliceRegForKim!.registeredAgent).toBe(kimId)

  const accessGrant = aliceRegForKim!.accessGrant

  if (expectGrant) {
    expect(accessGrant).toBeDefined()
    expect(accessGrant!.granted).toBe(true)
    expect(accessGrant!.grantedBy).toBe(aliceId)

    const projectGrant = accessGrant!.hasDataGrant.find(
      (grant) => grant.registeredShapeTree === projectShapeTree
    )
    expect(projectGrant).toBeDefined()
    expect(projectGrant!.scopeOfGrant.value).toBe(
      'http://www.w3.org/ns/solid/interop#AllFromRegistry'
    )
    expect(projectGrant!.dataOwner).toBe(aliceId)
  } else {
    expect(accessGrant).toBeUndefined()
  }
}

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

async function rpcCall(payload: unknown, cookie: string) {
  const response = await fetch(rpcEndpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: cookie,
    },
    body: JSON.stringify(payload),
  })
  expect(response.status).toBe(200)
  const body = await response.json()
  const result = body[0]
  expect(result._tag).toBe('Success')
  return result.value
}

describe('role-based access', () => {
  const aliceId = 'https://id/alice'
  const aliceCookie = 'css-account=8187358a-2072-4dce-9c76-24caffcc84a4'
  const kimId = 'https://id/kim'
  const bobId = 'https://id/bob'
  const roleId = 'https://registry/alice/role/j1g128'
  const chumsRoleId = 'https://registry/alice/role/xcoq3l'
  const projectShapeTree = 'https://data/shapetrees/trees/Project'

  test('create role test role', async () => {
    const body = await rpcCall(
      rpcPayload({
        _tag: 'CreateRole',
        label: 'Test Role',
        members: [],
      }),
      aliceCookie
    )
    expect(body.id).toMatch('https://registry/alice/role/')
    expect(body.label).toBe('Test Role')
    expect(body.members).toEqual([])

    const manager = buildSessionManager()
    const session = await manager.getSession(aliceId)
    const role = await session.findRole(body.id)
    expect(role).toBeDefined()
    expect(role!.label).toBe('Test Role')
    expect(role!.members).toEqual([])
  })

  test('delete role test', async () => {
    const manager = buildSessionManager()
    const session = await manager.getSession(aliceId)
    const role = await session.findRole(roleId)
    expect(role).toBeDefined()

    await rpcCall(
      rpcPayload({
        _tag: 'DeleteRole',
        id: roleId,
      }),
      aliceCookie
    )

    const deletedRole = await session.findRole(roleId)
    expect(deletedRole).toBeUndefined()
  })

  test('update role chums remove kim add bob', async () => {
    const body = await rpcCall(
      rpcPayload({
        _tag: 'UpdateRole',
        id: chumsRoleId,
        label: 'Chums',
        members: [bobId],
      }),
      aliceCookie
    )
    expect(body.label).toBe('Chums')
    expect(body.members).toEqual([bobId])

    const manager = buildSessionManager()
    const session = await manager.getSession(aliceId)
    const role = await session.findRole(chumsRoleId)
    expect(role).toBeDefined()
    expect(role!.label).toBe('Chums')
    expect(role!.members).toEqual([bobId])
  })

  test('grant is created when kim is added to role and revoked when removed', async () => {
    await rpcCall(
      rpcPayload({
        _tag: 'UpdateRole',
        id: roleId,
        label: 'Test',
        members: [kimId],
      }),
      aliceCookie
    )

    await verifyAccessGrant(kimId, aliceId, projectShapeTree, true)

    await rpcCall(
      rpcPayload({
        _tag: 'UpdateRole',
        id: roleId,
        label: 'Test',
        members: [],
      }),
      aliceCookie
    )

    await verifyAccessGrant(kimId, aliceId, projectShapeTree, false)
  })
})
