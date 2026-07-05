import { buildSessionManager } from '@elfpavlik/sai-components'
import { describe, expect, test } from 'vitest'

const rpcEndpoint = 'https://auth/.sai/api'

async function verifyAccessGrant(
  granteeId: string,
  grantedById: string,
  dataOwnerId: string,
  shapeTree: string,
  expectGrant: boolean
) {
  const manager = buildSessionManager()
  const granteeSession = await manager.getSession(granteeId)

  const granteeRegForGrantedBy = await granteeSession.findSocialAgentRegistration(grantedById)
  expect(granteeRegForGrantedBy).toBeDefined()
  expect(granteeRegForGrantedBy!.registeredAgent).toBe(grantedById)

  const grantedByRegForGrantee = granteeRegForGrantedBy!.reciprocalRegistration
  expect(grantedByRegForGrantee).toBeDefined()
  expect(grantedByRegForGrantee!.registeredAgent).toBe(granteeId)

  const accessGrant = grantedByRegForGrantee!.accessGrant

  const dataGrant = accessGrant?.hasDataGrant.find(
    (grant) =>
      grant.registeredShapeTree === shapeTree &&
      grant.grantedBy === grantedById &&
      grant.dataOwner === dataOwnerId
  )

  if (expectGrant) {
    expect(accessGrant).toBeDefined()
    expect(accessGrant!.granted).toBe(true)
    expect(accessGrant!.grantedBy).toBe(grantedById)
    expect(accessGrant!.grantee).toBe(granteeId)

    expect(dataGrant).toBeDefined()
    expect(dataGrant!.scopeOfGrant.value).toBe('http://www.w3.org/ns/solid/interop#AllFromRegistry')
    expect(dataGrant!.dataOwner).toBe(dataOwnerId)
  } else {
    expect(dataGrant).toBeUndefined()
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
  const bobCookie = 'css-account=339642f3-f3ee-42e5-85b9-4b1ab6b27ddc'
  const danId = 'https://id/dan'
  const yoyoId = 'https://id/yoyo'
  const roleId = 'https://registry/alice/role/j1g128'
  const chumsRoleId = 'https://registry/alice/role/xcoq3l'
  const whizRoleId = 'https://registry/bob/role/v7emok'
  const bizRoleId = 'https://registry/bob/role/t6nwde'
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

    await verifyAccessGrant(kimId, aliceId, aliceId, projectShapeTree, true)

    await rpcCall(
      rpcPayload({
        _tag: 'UpdateRole',
        id: roleId,
        label: 'Test',
        members: [],
      }),
      aliceCookie
    )

    await verifyAccessGrant(kimId, aliceId, aliceId, projectShapeTree, false)
  })

  describe('AllFromRole scope', () => {
    const payload = rpcPayload({
      _tag: 'AuthorizeApp',
      authorization: {
        grantee: whizRoleId,
        agentType: 'http://www.w3.org/ns/solid/interop#Role',
        accessNeedGroup: 'https://data/test-client/public/access-needs#need-group-pm',
        dataAuthorizations: [
          {
            accessNeed: 'https://data/test-client/public/access-needs#need-project',
            scope: 'AllFromRole',
            dataOwner: bizRoleId,
          },
          {
            accessNeed: 'https://data/test-client/public/access-needs#need-task',
            scope: 'Inherited',
          },
        ],
        granted: true,
      },
    })
    test('existing authorization - add remove members to roles', async () => {
      const body = await rpcCall(payload, bobCookie)
      expect(body.granted).toBe(true)
      expect(body.id).toMatch('https://registry/bob/authorization/')

      const manager = buildSessionManager()
      const bobSession = await manager.getSession(bobId)

      const initialRole = await bobSession.findRole(whizRoleId)
      const initialMembers = initialRole?.members ?? []

      await rpcCall(
        rpcPayload({
          _tag: 'UpdateRole',
          id: whizRoleId,
          label: initialRole?.label ?? 'Whiz',
          members: [...initialMembers, danId],
        }),
        bobCookie
      )

      await verifyAccessGrant(danId, bobId, yoyoId, projectShapeTree, true)

      await rpcCall(
        rpcPayload({
          _tag: 'UpdateRole',
          id: bizRoleId,
          label: 'Biz',
          members: [],
        }),
        bobCookie
      )

      await verifyAccessGrant(danId, bobId, yoyoId, projectShapeTree, false)
    })

    test('create authorization for role with existing members', async () => {
      await rpcCall(
        rpcPayload({
          _tag: 'UpdateRole',
          id: whizRoleId,
          label: 'Whiz',
          members: [danId],
        }),
        bobCookie
      )

      const body = await rpcCall(payload, bobCookie)
      expect(body.granted).toBe(true)
      expect(body.id).toMatch('https://registry/bob/authorization/')

      await verifyAccessGrant(danId, bobId, yoyoId, projectShapeTree, true)
    })

    test('delete grantee role', async () => {
      const body = await rpcCall(payload, bobCookie)
      expect(body.granted).toBe(true)
      expect(body.id).toMatch('https://registry/bob/authorization/')

      await rpcCall(
        rpcPayload({
          _tag: 'UpdateRole',
          id: whizRoleId,
          label: 'Whiz',
          members: [danId],
        }),
        bobCookie
      )

      await verifyAccessGrant(danId, bobId, yoyoId, projectShapeTree, true)

      await rpcCall(
        rpcPayload({
          _tag: 'DeleteRole',
          id: whizRoleId,
        }),
        bobCookie
      )

      await verifyAccessGrant(danId, bobId, yoyoId, projectShapeTree, false)
    })

    test('delete dataOwner role', async () => {
      const body = await rpcCall(payload, bobCookie)
      expect(body.granted).toBe(true)
      expect(body.id).toMatch('https://registry/bob/authorization/')

      await rpcCall(
        rpcPayload({
          _tag: 'UpdateRole',
          id: whizRoleId,
          label: 'Whiz',
          members: [danId],
        }),
        bobCookie
      )

      await verifyAccessGrant(danId, bobId, yoyoId, projectShapeTree, true)

      await rpcCall(
        rpcPayload({
          _tag: 'DeleteRole',
          id: bizRoleId,
        }),
        bobCookie
      )

      await verifyAccessGrant(danId, bobId, yoyoId, projectShapeTree, false)
    })
  })
})
