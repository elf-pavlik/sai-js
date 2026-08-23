import { buildOidcSession, buildSessionManager } from '@elfpavlik/sai-components'
import { getDataGrantIris } from '@janeirodigital/interop-data-model'
import { LDP, parseTurtle } from '@janeirodigital/interop-utils'
import { describe, expect, test } from 'vitest'

const rpcEndpoint = 'https://auth/.sai/api'
const acmeCookie = 'css-account=a1b9f0e2-3c4d-4e5f-8a7b-0c9d1e2f3a4b'
const acmeId = 'https://id/acme'
const bobId = 'https://id/bob'
const grantRegistry = 'https://registry/acme/grant/'
// seeded in environments/data/registry.trig
const seededGrantCount = 10

const p9m2vr = `${grantRegistry}p9m2vr` // Project parent — bob, grantedBy acme
const x4j8lm = `${grantRegistry}x4j8lm` // Project parent — bob, grantedBy acme
const hdaymz = `${grantRegistry}hdaymz` // Task child of p9m2vr
const q2v9pt = `${grantRegistry}q2v9pt` // Task child of x4j8lm

function rpcPayload(grants: string[]) {
  return [
    {
      request: { _tag: 'RevokeGrants', grants, context: acmeId },
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

async function countGrants(): Promise<number> {
  const session = await buildOidcSession(acmeId)
  const response = await session.authFetch(grantRegistry, {
    headers: { Accept: 'text/turtle' },
  })
  expect(response.status).toBe(200)
  const dataset = await parseTurtle(await response.text())
  return Array.from(dataset).filter((quad) => quad.predicate.value === LDP.contains).length
}

/** The grantee's hasDataGrant links in acme's registry (acme's projection). */
async function registrationGrantIris(granteeId: string): Promise<string[]> {
  const manager = buildSessionManager()
  const acmeSession = await manager.getSession(acmeId)
  const registration = await acmeSession.findSocialAgentRegistration(granteeId)
  expect(registration).toBeDefined()
  return getDataGrantIris(registration!)
}

describe('DataOwnerGrantRevocationRpc', () => {
  test('owner revokes source grants and clears its own registration', async (): Promise<void> => {
    const grants = [p9m2vr, x4j8lm]
    const value = await rpcCall(rpcPayload(grants), acmeCookie)
    // echo contract: response equals the request's grants
    expect(value).toEqual(grants)

    // parents and their inheriting children are gone from the registry
    expect(await countGrants()).toBe(seededGrantCount - 4)
    // acme's own projection of bob no longer links any removed grant
    expect(await registrationGrantIris(bobId)).toEqual([])
  })

  test('re-revoking an already-removed grant is an idempotent echo', async (): Promise<void> => {
    expect(await rpcCall(rpcPayload([p9m2vr]), acmeCookie)).toEqual([p9m2vr])
    expect(await rpcCall(rpcPayload([p9m2vr]), acmeCookie)).toEqual([p9m2vr])

    // p9m2vr + its inheriting child hdaymz removed; the unrelated parent
    // x4j8lm subtree is untouched
    expect(await countGrants()).toBe(seededGrantCount - 2)
    expect(await registrationGrantIris(bobId)).toEqual([x4j8lm, q2v9pt])
  })

  test('mixing existing and already-removed grants echoes both and removes the existing', async (): Promise<void> => {
    const grants = [p9m2vr, `${grantRegistry}does-not-exist`]
    expect(await rpcCall(rpcPayload(grants), acmeCookie)).toEqual(grants)
    expect(await countGrants()).toBe(seededGrantCount - 2)
  })
})
