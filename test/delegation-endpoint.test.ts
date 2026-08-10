import { ACL, INTEROP, buildOidcSession, issuanceUrl } from '@elfpavlik/sai-components'
import type { GrantData } from '@janeirodigital/interop-data-model'
import { describe, expect, test } from 'vitest'
import { SOLIDTREES } from './vocabularies'

// Incoming payload has hasInheritingGrant as embedded objects (full grant data).
// This mirrors the IncomingGrantData type in GrantIssuanceHandler.
type IncomingGrantData = Omit<GrantData, 'hasInheritingGrant'> & {
  hasInheritingGrant?: IncomingGrantData[]
}

const bobId = 'https://id/bob'
const acmeId = 'https://id/acme'
const testClient = 'https://data/test-client/public/id'

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

describe('DelegationIssuanceEndpoint', () => {
  describe('agent delegates to application', (): void => {
    test('happy path', async (): Promise<void> => {
      const session = await buildOidcSession(bobId)
      const response = await session.authFetch(issuanceUrl(acmeId), {
        method: 'POST',
        body: JSON.stringify(projectsGrantData),
      })
      expect(response.status).toBe(200)
      const ids = await response.json()
      ids.forEach((id: string) => {
        expect(id).toMatch('https://registry/acme/grant/')
      })
    })
    test('invalid grantedBy', async (): Promise<void> => {
      const session = await buildOidcSession(bobId)
      const response = await session.authFetch(issuanceUrl(acmeId), {
        method: 'POST',
        body: JSON.stringify({
          ...projectsGrantData,
          grantedBy: 'https://id/kim',
        }),
      })
      expect(response.status).toBe(400)
    })
    test('wrong client', async (): Promise<void> => {
      const clientId = 'https://data/test-client/public/id'
      const session = await buildOidcSession(bobId, clientId)
      const response = await session.authFetch(issuanceUrl(acmeId), {
        method: 'POST',
        body: JSON.stringify(projectsGrantData),
      })
      expect(response.status).toBe(403)
    })
  })
})
