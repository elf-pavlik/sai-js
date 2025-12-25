import { buildOidcSession } from '@janeirodigital/sai-components'
import { describe, expect, test } from 'vitest'

const rpcEndpoint = 'https://auth/.sai/api'
const aliceId = 'https://id/alice'
const aliceCookie = 'css-account=8187358a-2072-4dce-9c76-24caffcc84a4'

describe('create invitation', () => {
  const invitationData = {
    label: 'Bob',
    note: 'Some note',
  }
  const payload = [
    {
      request: {
        _tag: 'CreateInvitation',
        ...invitationData,
      },
      headers: {},
      traceId: '13c2035f72f45c1ebbf13b055b7dc526',
      spanId: '685581075752b8a2',
      sampled: true,
    },
  ]

  test('responds with invitation', async () => {
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
    expect(value).toEqual(expect.objectContaining(invitationData))
    expect(value.capabilityUrl).toMatch('https://auth.docker/.sai/invitations')

    const session = await buildOidcSession(aliceId)
    const check = await session.authFetch(value.id)
    expect(check.status).toBe(200)
    // TODO: validate data using SocialAgentInvitation shape
  })
})
