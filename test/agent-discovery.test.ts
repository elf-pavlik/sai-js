import { getAgentRegistrationIri } from '@janeirodigital/interop-utils'
import { buildOidcSession } from '@janeirodigital/sai-components'
import { describe, expect, test } from 'vitest'

const baseUrl = process.env.CSS_BASE_URL

const aliceId = 'https://id/alice'
const encodedAliceId = Buffer.from(aliceId).toString('base64url')
const bobId = 'https://id/bob'
const encodedBobId = Buffer.from(bobId).toString('base64url')
const pathPrefix = '.sai/agents/'
const aliceAgentId = `${baseUrl}${pathPrefix}${encodedAliceId}`
const bobAgentId = `${baseUrl}${pathPrefix}${encodedBobId}`

describe('AgentIdHandler', () => {
  test('id', async () => {
    const response = await fetch(aliceAgentId)
    const doc = await response.json()
    expect(response.status).toBe(200)
    expect(doc.client_id).toBe(aliceAgentId)
  })
  for (const method of ['HEAD', 'GET']) {
    describe('responds with social agent registry in headers', (): void => {
      test(method, async (): Promise<void> => {
        const session = await buildOidcSession(bobId, bobAgentId)
        const response = await session.authFetch(aliceAgentId, { method })
        expect(response.status).toBe(200)
        const linkHeader = response.headers.get('Link')
        expect(linkHeader).toBeDefined()
        expect(getAgentRegistrationIri(linkHeader!)).toBe('https://registry/alice/agent/vzp6ky/')
      })
    })
    describe('responds with application registry in headers', (): void => {
      test(method, async (): Promise<void> => {
        const client_id = 'https://data/test-client/public/id'
        const session = await buildOidcSession(aliceId, client_id)
        const response = await session.authFetch(aliceAgentId)
        expect(response.status).toBe(200)
        const linkHeader = response.headers.get('Link')
        expect(linkHeader).toBeDefined()
        expect(getAgentRegistrationIri(linkHeader!)).toBe('https://registry/alice/agent/cvmsa4/')
      })
    })
    describe('responds with no Link if no registry was found', (): void => {
      test(method, async (): Promise<void> => {
        const client_id = 'https://missing.example'
        const session = await buildOidcSession(aliceId, client_id)
        const response = await session.authFetch(aliceAgentId)
        expect(response.status).toBe(200)
        const linkHeader = response.headers.get('Link')
        expect(linkHeader).toBeNull()
      })
    })
  }
})
