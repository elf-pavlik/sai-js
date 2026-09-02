import { buildOidcSession, buildSessionManager, issuanceUrl } from '@elfpavlik/sai-components'
import { ActivityRegistry } from '@janeirodigital/interop-authorization-agent'
import { getDataGrantIris, type GrantsRevoked } from '@janeirodigital/interop-data-model'
import type { IncomingGrantData } from '@janeirodigital/interop-data-model'
import { ACL, INTEROP, LDP, parseTurtle } from '@janeirodigital/interop-utils'
import { describe, expect, test } from 'vitest'
import { waitFor } from './util'
import { SOLIDTREES } from './vocabularies'

const bobId = 'https://id/bob'
const aliceId = 'https://id/alice'
const acmeId = 'https://id/acme'
const testClient = 'https://data/test-client/public/id'
const grantRegistry = 'https://registry/acme/grant/'
// seeded in environments/data/registry.trig
const seededGrantCount = 10

const commonGrantData = {
  grantedBy: bobId,
  dataOwner: acmeId,
  grantee: testClient,
  hasStorage: 'https://data/acme-rnd/',
}
const tasksGrantData: IncomingGrantData = {
  ...commonGrantData,
  registeredShapeTree: SOLIDTREES.Task,
  hasDataRegistration: 'https://data/acme-rnd/x0md9s/',
  accessMode: [ACL.Read, ACL.Update],
  scopeOfGrant: INTEROP.Inherited,
}
const projectsGrantData: IncomingGrantData = {
  ...commonGrantData,
  registeredShapeTree: SOLIDTREES.Project,
  hasDataRegistration: 'https://data/acme-rnd/reb39k/',
  accessMode: [ACL.Read, ACL.Update],
  scopeOfGrant: INTEROP.AllFromRegistry,
  hasInheritingGrant: [tasksGrantData],
}
// second delegable chain from the seed: acme-hr project → inherited task
const hrCommonGrantData = {
  ...commonGrantData,
  hasStorage: 'https://data/acme-hr/',
}
const hrTasksGrantData: IncomingGrantData = {
  ...hrCommonGrantData,
  registeredShapeTree: SOLIDTREES.Task,
  hasDataRegistration: 'https://data/acme-hr/v4n2qx/',
  accessMode: [ACL.Read, ACL.Update],
  scopeOfGrant: INTEROP.Inherited,
}
const hrProjectsGrantData: IncomingGrantData = {
  ...hrCommonGrantData,
  registeredShapeTree: SOLIDTREES.Project,
  hasDataRegistration: 'https://data/acme-hr/p7t9km/',
  accessMode: [ACL.Read, ACL.Update],
  scopeOfGrant: INTEROP.AllFromRegistry,
  hasInheritingGrant: [hrTasksGrantData],
}

const issuancePayload = (grants: IncomingGrantData[]): string =>
  JSON.stringify({ type: [INTEROP.AccessRequest], grants })

async function countGrants(): Promise<number> {
  const session = await buildOidcSession(acmeId)
  const response = await session.authFetch(grantRegistry, {
    headers: { Accept: 'text/turtle' },
  })
  expect(response.status).toBe(200)
  const dataset = await parseTurtle(await response.text())
  return Array.from(dataset).filter((quad) => quad.predicate.value === LDP.contains).length
}

const revocationPayload = (grants: string[]): string =>
  JSON.stringify({ type: [INTEROP.AccessRevocation], grants })

async function issueProjectsGrant(): Promise<string[]> {
  const session = await buildOidcSession(bobId)
  const response = await session.authFetch(issuanceUrl(acmeId), {
    method: 'POST',
    body: issuancePayload([projectsGrantData]),
  })
  expect(response.status).toBe(200)
  return (await response.json()) as string[]
}

describe('DelegationRevocationEndpoint', () => {
  test('revokes a listed grant and its inheriting child', async (): Promise<void> => {
    const ids = await issueProjectsGrant()
    const [parentId, childId] = ids

    // a grantor cannot DELETE grant resources directly (DD14 — read-only ACR)
    const bobSession = await buildOidcSession(bobId)
    const directDelete = await bobSession.authFetch(childId, { method: 'DELETE' })
    expect(directDelete.status).toBe(403)

    const session = await buildOidcSession(bobId)
    const response = await session.authFetch(issuanceUrl(acmeId), {
      method: 'POST',
      body: revocationPayload([parentId]),
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual([parentId])

    // the child dies with its parent — the registry is back to the seed
    expect(await countGrants()).toBe(seededGrantCount)
  })

  test('re-revoking an already-removed grant is an idempotent echo', async (): Promise<void> => {
    const ids = await issueProjectsGrant()
    const [parentId] = ids
    const session = await buildOidcSession(bobId)

    const first = await session.authFetch(issuanceUrl(acmeId), {
      method: 'POST',
      body: revocationPayload([parentId]),
    })
    expect(first.status).toBe(200)
    expect(await first.json()).toEqual([parentId])

    const second = await session.authFetch(issuanceUrl(acmeId), {
      method: 'POST',
      body: revocationPayload([parentId]),
    })
    expect(second.status).toBe(200)
    expect(await second.json()).toEqual([parentId])
    expect(await countGrants()).toBe(seededGrantCount)
  })

  test('mixed existing and already-removed grants echoes both and removes the existing', async (): Promise<void> => {
    const ids = await issueProjectsGrant()
    const [parentId] = ids

    const session = await buildOidcSession(bobId)
    const response = await session.authFetch(issuanceUrl(acmeId), {
      method: 'POST',
      body: revocationPayload([parentId, 'https://registry/acme/grant/does-not-exist']),
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual([parentId, 'https://registry/acme/grant/does-not-exist'])
    expect(await countGrants()).toBe(seededGrantCount)
  })

  test('unauthorized grantor fails the whole request with no mutation', async (): Promise<void> => {
    const ids = await issueProjectsGrant()
    const [parentId] = ids

    const kimSession = await buildOidcSession('https://id/kim')
    const response = await kimSession.authFetch(issuanceUrl(acmeId), {
      method: 'POST',
      body: revocationPayload([parentId]),
    })
    expect(response.status).toBe(403)
    expect(await countGrants()).toBe(seededGrantCount + 2)
  })
})

describe('DelegationRevocationRequesterHop', () => {
  test('pending activity → AccessRevocation → registration cleared → done', async () => {
    // seeded fixtures (no runtime grant issuance): alice's application
    // registration for testClient (registry/alice/application/cvmsa4/) already links
    // the seeded acme grants wwp4j6 (Project parent) and qwvbcu (inheriting
    // Task child); the only writer is the requester-hop workflow
    const aliceGrant = 'https://registry/acme/grant/wwp4j6'
    const aliceChildGrant = 'https://registry/acme/grant/qwvbcu'

    const manager = buildSessionManager()
    const aliceSession = await manager.getSession(aliceId)

    // pending grantsRevoked activity in alice's outbox → the seeded
    // activity-webhook channel starts processGrantsRevocation
    const activityRegistry = aliceSession.registrySet.hasActivityRegistry
    if (!activityRegistry) throw new Error('activity registry not found')
    const grantsRevokedActivity: Omit<GrantsRevoked, 'id'> = {
      type: ['Activity', 'GrantsRevoked'],
      actor: aliceId,
      target: aliceId,
      grantee: testClient,
      dataOwner: acmeId,
      object: [aliceGrant, aliceChildGrant],
      createdAt: new Date().toISOString(),
    }
    await ActivityRegistry.createActivity(
      activityRegistry,
      { fetch: aliceSession.fetch, randomUUID: aliceSession.randomUUID },
      grantsRevokedActivity
    )

    // await the requester-hop workflow to completion FIRST — a failing test
    // must not leave the workflow running into the next test's reseed
    const registry = aliceSession.registrySet.hasActivityRegistry!
    await waitFor(
      async () => {
        const completed = await ActivityRegistry.getCompletedActivityIris(
          registry,
          aliceSession.fetch
        )
        if (!completed.length) return false
        const all = await ActivityRegistry.getActivityIris(registry, aliceSession.fetch)
        for (const iri of all) {
          const activity = await ActivityRegistry.loadActivity(iri, aliceSession.fetch)
          if (activity.type.includes('GrantsRevoked') && completed.includes(activity.id)) {
            return true
          }
        }
        return false
      },
      { timeout: 30_000 }
    )

    // the grants are revoked in acme's registry (parent + inheriting child) …
    expect(await countGrants()).toBe(seededGrantCount - 2)
    // … and the grantor's registration projection is cleared
    const refreshed = await aliceSession.findApplicationRegistration(testClient)
    if (!refreshed) throw new Error('application registration not found')
    const iris = await getDataGrantIris(refreshed)
    expect(iris).not.toContain(aliceGrant)
    expect(iris).not.toContain(aliceChildGrant)
  })
})

describe('DelegationIssuanceEndpoint', () => {
  describe('agent delegates to application', (): void => {
    test('happy path', async (): Promise<void> => {
      const session = await buildOidcSession(bobId)
      const response = await session.authFetch(issuanceUrl(acmeId), {
        method: 'POST',
        body: issuancePayload([projectsGrantData]),
      })
      expect(response.status).toBe(200)
      const ids = await response.json()
      expect(ids).toHaveLength(2) // parent + inheriting child
      ids.forEach((id: string) => {
        expect(id).toMatch(grantRegistry)
      })
      expect(await countGrants()).toBe(seededGrantCount + 2)
    })
    test('multiple grants are issued all-or-nothing', async (): Promise<void> => {
      const session = await buildOidcSession(bobId)
      const response = await session.authFetch(issuanceUrl(acmeId), {
        method: 'POST',
        body: issuancePayload([projectsGrantData, hrProjectsGrantData]),
      })
      expect(response.status).toBe(200)
      const ids = await response.json()
      expect(ids).toHaveLength(4) // two parents + two inheriting children
      ids.forEach((id: string) => {
        expect(id).toMatch(grantRegistry)
      })
      expect(await countGrants()).toBe(seededGrantCount + 4)
    })
    test('invalid grantedBy fails and nothing is created', async (): Promise<void> => {
      const session = await buildOidcSession(bobId)
      const response = await session.authFetch(issuanceUrl(acmeId), {
        method: 'POST',
        body: issuancePayload([{ ...projectsGrantData, grantedBy: 'https://id/kim' }]),
      })
      expect(response.status).toBe(400)
      expect(await countGrants()).toBe(seededGrantCount)
    })
    test('different dataOwner fails all grants and nothing is created', async (): Promise<void> => {
      const session = await buildOidcSession(bobId)
      const response = await session.authFetch(issuanceUrl(acmeId), {
        method: 'POST',
        body: issuancePayload([
          { ...projectsGrantData, dataOwner: 'https://id/kim' },
          projectsGrantData,
        ]),
      })
      expect(response.status).toBe(400)
      expect(await countGrants()).toBe(seededGrantCount)
    })
    test('empty grants fails', async (): Promise<void> => {
      const session = await buildOidcSession(bobId)
      const response = await session.authFetch(issuanceUrl(acmeId), {
        method: 'POST',
        body: issuancePayload([]),
      })
      expect(response.status).toBe(400)
    })
    test('wrong client', async (): Promise<void> => {
      const clientId = 'https://data/test-client/public/id'
      const session = await buildOidcSession(bobId, clientId)
      const response = await session.authFetch(issuanceUrl(acmeId), {
        method: 'POST',
        body: issuancePayload([projectsGrantData]),
      })
      expect(response.status).toBe(403)
    })
  })
})
