import { accessGrantsUrl, buildOidcSession, buildSessionManager } from '@elfpavlik/sai-components'
import {
  getRegistryGrants,
  localSparqlTransport,
  type AuthorizationAgent,
} from '@janeirodigital/interop-authorization-agent'
import {
  type GrantData,
  grantDataOwner,
  grantGrantee,
  grantRequester,
} from '@janeirodigital/interop-data-model'
import { LWS } from '@janeirodigital/interop-utils'
import { describe, expect, test } from 'vitest'

const aliceId = 'https://id/alice'
const bobId = 'https://id/bob'
const acmeId = 'https://id/acme'
const testClient = 'https://data/test-client/public/id'

async function ownerGrants(owner: string): Promise<GrantData[]> {
  const session: AuthorizationAgent = await buildSessionManager().getSession(owner)
  const registry = session.registrySet.hasGrantRegistry
  if (!registry) throw new Error('grant registry missing')
  return getRegistryGrants(localSparqlTransport(session.sparqlEndpoint), registry.id)
}

describe('access grant view', () => {
  test('the UAS sees every assigner-registry grant where the user is assignee or requester', async () => {
    const grants = await ownerGrants(acmeId)
    const expected = grants
      .filter(
        (grant) =>
          grantDataOwner(grant) === acmeId &&
          (grantGrantee(grant) === acmeId || grantRequester(grant) === acmeId)
      )
      .map((grant) => grant.id!)
      .toSorted()
    expect(expected.length).toBeGreaterThan(0)

    const session = await buildOidcSession(acmeId)
    const response = await session.authFetch(accessGrantsUrl(acmeId), {
      headers: { Accept: 'application/lws+json' },
    })
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('application/lws+json')
    const body = (await response.json()) as Record<string, any>[]
    expect(body.map((grant) => grant.id as string).toSorted()).toEqual(expected)

    // wire documents stay in the canonical LWS shape; derived POJO fields are
    // not part of the response
    for (const grant of body) {
      expect(grant.type).toContain(LWS.AccessGrant)
      expect(grant.dataOwner).toBeUndefined()
      expect(grant.grantedBy).toBeUndefined()
      expect(grant.access[0].permission[0].assigner).toBe(acmeId)
    }
  })

  test('a social agent UAS sees the grants where it is assignee or requester', async () => {
    const grants = await ownerGrants(acmeId)
    const expected = grants
      .filter(
        (grant) =>
          grantDataOwner(grant) === acmeId &&
          (grantGrantee(grant) === bobId || grantRequester(grant) === bobId)
      )
      .map((grant) => grant.id!)
      .toSorted()
    expect(expected.length).toBeGreaterThan(0)

    const session = await buildOidcSession(bobId)
    const response = await session.authFetch(accessGrantsUrl(acmeId))
    expect(response.status).toBe(200)
    const body = (await response.json()) as { id: string }[]
    expect(body.map((grant) => grant.id).toSorted()).toEqual(expected)
  })

  test('another client sees only grants assigned to it by the authenticated user', async () => {
    const grants = await ownerGrants(acmeId)
    const expected = grants
      .filter(
        (grant) =>
          grantDataOwner(grant) === acmeId &&
          grantGrantee(grant) === testClient &&
          grantDataOwner(grant) === acmeId
      )
      .map((grant) => grant.id!)
      .toSorted()
    expect(expected.length).toBeGreaterThan(0)

    const session = await buildOidcSession(acmeId, testClient)
    const response = await session.authFetch(accessGrantsUrl(acmeId))
    expect(response.status).toBe(200)
    const body = (await response.json()) as { id: string }[]
    expect(body.map((grant) => grant.id).toSorted()).toEqual(expected)
  })

  test('a non-UAS client only sees grants assigned to that client', async () => {
    const session = await buildOidcSession(acmeId, testClient)
    const response = await session.authFetch(accessGrantsUrl(acmeId))
    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      access: { permission: { assignee: string }[] }[]
    }[]
    expect(body.length).toBeGreaterThan(0)
    for (const grant of body) {
      expect(grant.access[0].permission[0].assignee).toBe(testClient)
    }
  })

  test('owner and other-client views only read the assigner registry', async () => {
    const aliceSession = await buildOidcSession(aliceId, testClient)
    const response = await aliceSession.authFetch(accessGrantsUrl(acmeId))
    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      access: { permission: { assigner: string; assignee: string }[] }[]
    }[]
    // Alice is not the assigner, so the non-UAS branch yields nothing even if
    // she is a grantee/requester elsewhere (delegated/mirrored grants are TODO).
    expect(body).toEqual([])
  })

  test('HEAD is supported and POST is not', async () => {
    const session = await buildOidcSession(acmeId)
    const head = await session.authFetch(accessGrantsUrl(acmeId), { method: 'HEAD' })
    expect(head.status).toBe(200)
    expect(await head.text()).toBe('')

    const post = await session.authFetch(accessGrantsUrl(acmeId), {
      method: 'POST',
      headers: { 'Content-Type': 'application/ld+json' },
      body: '[]',
    })
    expect(post.status).toBe(405)
  })

  test('unauthenticated reads get 401', async () => {
    const response = await fetch(accessGrantsUrl(acmeId))
    expect(response.status).toBe(401)
  })
})
