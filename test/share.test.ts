import { buildSessionManager } from '@elfpavlik/sai-components'
import {
  getDataGrantIris,
  getDataGrants,
  loadSocialAgentRegistration,
} from '@janeirodigital/interop-data-model'
import { AS } from '@janeirodigital/interop-utils'
import { describe, expect, test } from 'vitest'
import { awaitGrantCompletion } from './util'

const rpcEndpoint = 'https://auth/.sai/api'

describe('share resource', () => {
  const aliceId = 'https://id/alice'
  const aliceCookie = 'css-account=8187358a-2072-4dce-9c76-24caffcc84a4'
  const kimId = 'https://id/kim'
  const applicationId = 'https://data/test-client/public/id'
  const resource = 'https://data/alice-home/x1n3cm/n8k3wp'
  const projectShapeTree = 'https://data/shapetrees/trees/Project'
  const readMode = 'http://www.w3.org/ns/auth/acl#Read'

  test('shares a data instance with a social agent', async () => {
    const manager = buildSessionManager()
    const aliceSession = await manager.getSession(aliceId)

    // kim has no grants from alice yet — her registration is the outcome signal
    const regForKim = await aliceSession.findSocialAgentRegistration(kimId)
    expect(regForKim).toBeDefined()

    // trigger the share, await the registration Update AND the chain's
    // completion (shared barrier — the Update fires mid-chain, this also
    // waits for the workflow tail so the next write can't race it)
    await awaitGrantCompletion(aliceSession.fetch, regForKim.id, [aliceId, kimId], async () => {
      const response = await fetch(rpcEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: aliceCookie,
        },
        body: JSON.stringify([
          {
            request: {
              _tag: 'ShareResource',
              authorization: {
                applicationId,
                resource,
                agents: [kimId],
                accessMode: [readMode],
                children: [],
              },
              context: aliceId,
            },
            headers: {},
            traceId: '13c2035f72f45c1ebbf13b055b7dc526',
            spanId: '685581075752b8a2',
            sampled: true,
          },
        ]),
      })
      expect(response.status).toBe(200)
      const body = await response.json()
      const { _tag, value } = body[0]
      expect(_tag).toBe('Success')
      expect(value).toEqual(expect.objectContaining({ callbackEndpoint: 'https://test-client' }))
    })

    // verify the grant for the shared instance on alice's reciprocal registration for kim
    const kimSession = await manager.getSession(kimId)
    const kimRegForAlice = await kimSession.findSocialAgentRegistration(aliceId)
    const aliceRegForKim = await loadSocialAgentRegistration(
      kimRegForAlice.reciprocalRegistration!,
      kimSession.fetch
    )
    const dataGrants = await getDataGrants(aliceRegForKim, kimSession.fetch)
    const sharedGrant = dataGrants.find(
      (grant) =>
        grant.registeredShapeTree === projectShapeTree &&
        grant.grantedBy === aliceId &&
        grant.dataOwner === aliceId &&
        grant.hasDataInstance?.includes(resource)
    )
    expect((await getDataGrantIris(aliceRegForKim)).length).toBeGreaterThan(0)
    expect(sharedGrant).toBeDefined()
    expect(sharedGrant!.scopeOfGrant).toBe(
      'http://www.w3.org/ns/solid/interop#SelectedFromRegistry'
    )
    expect(sharedGrant!.accessMode).toEqual([readMode])
  })
})
