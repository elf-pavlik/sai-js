import { buildSessionManager } from '@elfpavlik/sai-components'
import { describe, expect, test } from 'vitest'
import { awaitGrantCompletion } from './util'

const rpcEndpoint = 'https://auth/.sai/api'
// TODO: import
const agentType = 'http://www.w3.org/ns/solid/interop#Application'
const clientId = 'https://data/test-client/public/id'
const accessNeedGroup = 'https://data/test-client/public/access-needs#need-group-pm'
const bobId = 'https://id/bob'

function rpcPayload(authorization: unknown) {
  return [
    {
      request: { _tag: 'AuthorizeApp', authorization, context: bobId },
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

describe('get authorization data', () => {
  const aliceId = 'https://id/alice'
  const aliceCookie = 'css-account=8187358a-2072-4dce-9c76-24caffcc84a4'
  const lang = 'en'

  const payload = [
    {
      request: {
        _tag: 'GetAuthoriaztionData',
        agentId: clientId,
        agentType,
        lang,
        context: aliceId,
      },
      headers: {},
      traceId: '13c2035f72f45c1ebbf13b055b7dc526',
      spanId: '685581075752b8a2',
      sampled: true,
    },
  ]

  test('responds with authorization data', async () => {
    const response = await fetch(rpcEndpoint, {
      method: 'POST',
      headers: {
        ContentType: 'application/json',
        Cookie: aliceCookie,
      },
      body: JSON.stringify(payload),
    })
    expect(response.status).toBe(200)
    const body = await response.json()
    const { _tag, value } = body[0]
    expect(_tag).toBe('Success')
    expect(value).toEqual(expect.objectContaining({ id: clientId, agentType }))
    expect(value.accessNeedGroup).toEqual(
      expect.objectContaining({
        label: 'Manage Projects',
        lang,
      })
    )
    expect(value.dataOwners).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: aliceId }),
        expect.objectContaining({ id: 'https://id/acme' }),
      ])
    )
    expect(value.accessNeedGroup.needs).toEqual(
      expect.arrayContaining([
        {
          id: 'https://data/test-client/public/access-needs#need-project',
          label:
            'Access to Projects is essential for Projectron to perform its core function of Project Management.',
          required: true,
          access: expect.arrayContaining([
            'http://www.w3.org/ns/auth/acl#Read',
            'http://www.w3.org/ns/auth/acl#Create',
            'http://www.w3.org/ns/auth/acl#Update',
            'http://www.w3.org/ns/auth/acl#Delete',
          ]),
          shapeTree: { id: 'https://data/shapetrees/trees/Project', label: 'Projects' },
          children: expect.arrayContaining([
            expect.objectContaining({
              id: 'https://data/test-client/public/access-needs#need-task',
            }),
            expect.objectContaining({
              id: 'https://data/test-client/public/access-needs#need-image',
            }),
            expect.objectContaining({
              id: 'https://data/test-client/public/access-needs#need-file',
            }),
          ]),
        },
      ])
    )
  })
})

describe('denied', () => {
  const bobCookie = 'css-account=339642f3-f3ee-42e5-85b9-4b1ab6b27ddc'

  const grantedAuthorization = {
    grantee: clientId,
    agentType,
    accessNeedGroup,
    dataAuthorizations: [
      {
        accessNeed: 'https://data/test-client/public/access-needs#need-project',
        scope: 'AllFromAgent',
        dataOwner: bobId,
      },
      { accessNeed: 'https://data/test-client/public/access-needs#need-task', scope: 'Inherited' },
      { accessNeed: 'https://data/test-client/public/access-needs#need-image', scope: 'Inherited' },
      { accessNeed: 'https://data/test-client/public/access-needs#need-file', scope: 'Inherited' },
    ],
    granted: true,
  }

  const deniedAuthorization = {
    grantee: clientId,
    agentType,
    accessNeedGroup,
    granted: false,
  }

  test('creates denied authorization', async () => {
    const manager = buildSessionManager()
    const session = await manager.getSession(bobId)
    const registration = await session.findApplicationRegistration(clientId)
    expect(registration).toBeDefined()

    // grant first — authorizationRecorded activity → grants appear on the
    // application registration; wait for the chain's completion (shared
    // barrier: Update + quiescence, so the deny below can't race the tail)
    await awaitGrantCompletion(session.fetch, registration.id, [bobId], async () => {
      const granted = await rpcCall(rpcPayload(grantedAuthorization), bobCookie)
      expect(Array.isArray(granted)).toBe(true)
      expect(granted.length).toBeGreaterThan(0)
    })
    expect(
      (await session.findApplicationRegistration(clientId))?.hasDataGrant?.length
    ).toBeGreaterThan(0)

    // deny — grants revoked (single registration Update)
    await awaitGrantCompletion(session.fetch, registration.id, [bobId], async () => {
      const denied = await rpcCall(rpcPayload(deniedAuthorization), bobCookie)
      expect(Array.isArray(denied)).toBe(true)
      expect(denied.length).toBe(0)
    })

    // the grantee's authorizations read via the registry plane (the data-model
    // HTTP `findDataAuthorizations` was removed in the final cleanup)
    const authorizations = await session.findAuthorizationsForAgent(clientId)
    expect(authorizations.length).toBe(0)
    const regAfterDeny = await session.findApplicationRegistration(clientId)
    expect((regAfterDeny?.hasDataGrant ?? []).length).toBe(0)
  })
})
