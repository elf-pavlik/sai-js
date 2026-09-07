import { buildOidcSession, buildSessionManager, issuanceUrl } from '@elfpavlik/sai-components'
import { ActivityRegistry, type AuthorizationAgent } from '@janeirodigital/interop-authorization-agent'
import {
  type NeedBasedAccessRequestSent,
  loadNeedBasedAccessRequest,
} from '@janeirodigital/interop-data-model'
import { LDP, linkedIrisJsonLd } from '@janeirodigital/interop-utils'
import { describe, expect, test } from 'vitest'
import {
  rpcPayload,
  waitForNeedBasedAccessRequestReceivedCompletion,
  waitForNeedBasedAccessRequestSentCompletion,
} from './util'

const rpcEndpoint = 'https://auth/.sai/api'

const aliceId = 'https://id/alice'
const bobId = 'https://id/bob'
const bobCookie = 'css-account=339642f3-f3ee-42e5-85b9-4b1ab6b27ddc'

const INTEROP = 'http://www.w3.org/ns/solid/interop#'
const ACL = 'http://www.w3.org/ns/auth/acl#'

/**
 * The embedded access need group — Bob requests access from Alice with
 * Project (+ inherited Task) needs. Values are (expanded-form) IRIs — the
 * payload rides the message (urn:uuid ids per the accept-invitation
 * precedent); description literals are the follow-up.
 */
const accessNeedGroup = {
  id: 'urn:uuid:6a1f3c2e-4b5d-4e6f-9a0b-1c2d3e4f5a6b',
  type: ['http://www.w3.org/ns/solid/interop#AccessNeedGroup'],
  hasAccessNeed: [
    {
      id: 'urn:uuid:7b2a4d3f-5c6e-4f70-9a1b-2c3d4e5f6a7b',
      type: ['http://www.w3.org/ns/solid/interop#AccessNeed'],
      registeredShapeTree: 'https://data/shapetrees/trees/Project',
      required: 'http://www.w3.org/ns/solid/interop#AccessRequired',
      accessMode: [ACL + 'Read', ACL + 'Create', ACL + 'Update', ACL + 'Delete'],
      hasInheritingNeed: [
        {
          id: 'urn:uuid:8c3b5e40-6d7f-4f81-9a2b-3c4d5e6f7a8b',
          type: ['http://www.w3.org/ns/solid/interop#AccessNeed'],
          registeredShapeTree: 'https://data/shapetrees/trees/Task',
          required: 'http://www.w3.org/ns/solid/interop#AccessRequired',
          accessMode: [ACL + 'Read', ACL + 'Create', ACL + 'Update', ACL + 'Delete'],
        },
      ],
    },
  ],
}

/** The stored AccessRequests of the session's (owner's) AccessRequestRegistry
 *  — container `ldp:contains` + the data-model loader (embeds the group). */
async function storedAccessRequests(session: AuthorizationAgent): Promise<any[]> {
  const registry = session.registrySet.hasAccessRequestRegistry
  expect(registry).toBeDefined()
  const iris = await linkedIrisJsonLd(registry!.id, session.fetch, LDP.contains)
  return Promise.all(iris.map((iri) => loadNeedBasedAccessRequest(iri, session.fetch)))
}

function expectRequestShape(
  request: any,
  { grantee, grantedBy, dataOwner }: { grantee: string; grantedBy: string; dataOwner: string }
) {
  expect(request.grantee).toBe(grantee)
  expect(request.grantedBy).toBe(grantedBy)
  expect(request.dataOwner).toBe(dataOwner)
  expect(request.hasAccessNeedGroup).toBeDefined()
  expect(request.hasAccessNeedGroup.id).toBe('urn:uuid:6a1f3c2e-4b5d-4e6f-9a0b-1c2d3e4f5a6b')
}

describe('request access (sent side)', () => {
  test('bob sends a need-based access request to alice via the access-needs RPC', async () => {
    const response = await fetch(rpcEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: bobCookie,
      },
      body: JSON.stringify(
        rpcPayload({
          _tag: 'RequestAccessUsingAccessNeeds',
          dataOwner: aliceId,
          hasAccessNeedGroup: accessNeedGroup,
          context: bobId,
        })
      ),
    })
    expect(response.status).toBe(200)
    const body = await response.json()
    const { _tag, value } = body[0]
    expect(_tag).toBe('Success')
    // the pending ack — the `InvitationAcceptedMessage` shape: the requester
    // mints no real id (the owner does, receive-side phase), so only the
    // claim anchor echoes
    expect(value).toEqual({
      accepted: true,
      activityId: expect.any(String),
    })
    expect(value.activityId).toMatch('https://registry/bob/activity/')

    // the requester-side workflow forwarded the request (the data owner's
    // endpoint responded 202) and completed the activity — the done event
    const manager = buildSessionManager()
    const session: AuthorizationAgent = await manager.getSession(bobId)
    await waitForNeedBasedAccessRequestSentCompletion(session)

    // the Sent activity carries the request snapshot with the embedded group
    const registry = session.registrySet.hasActivityRegistry
    expect(registry).toBeDefined()
    const iris = await ActivityRegistry.getActivityIris(registry!, session.fetch)
    const sentActivities = []
    for (const iri of iris) {
      const activity = await ActivityRegistry.loadActivity(iri, session.fetch)
      if (activity.type.includes('NeedBasedAccessRequestSent')) {
        sentActivities.push(activity as NeedBasedAccessRequestSent)
      }
    }
    expect(sentActivities.length).toBe(1)
    const object = sentActivities[0].object
    expect(object.id).toMatch(/^urn:uuid:/)
    // the class term may frame bare (the context row) or as the full IRI
    expect(object.type).toContain('NeedBasedAccessRequest')
    expect(object.grantee).toBe(bobId)
    expect(object.grantedBy).toBe(bobId)
    expect(object.dataOwner).toBe(aliceId)
    expect(object.hasAccessNeedGroup).toBeDefined()
    expect(object.hasAccessNeedGroup.id).toBe(
      'urn:uuid:6a1f3c2e-4b5d-4e6f-9a0b-1c2d3e4f5a6b'
    )
  })
})

describe('request access (receive side)', () => {
  test('leg A — the data owner endpoint receives and stores the request', async () => {
    // Bob's UAS POSTs DIRECTLY to Alice's (reused) issuance endpoint —
    // no RPC, no requester activity
    const session = await buildOidcSession(bobId)
    const response = await session.authFetch(issuanceUrl(aliceId), {
      method: 'POST',
      headers: { 'Content-Type': 'application/ld+json' },
      body: JSON.stringify({
        type: ['http://www.w3.org/ns/solid/interop#NeedBasedAccessRequest'],
        grantee: bobId,
        grantedBy: bobId,
        dataOwner: aliceId,
        hasAccessNeedGroup: accessNeedGroup,
      }),
    })
    expect(response.status).toBe(202)
    expect(await response.text()).toBe('')

    // the owner-side workflow materialized the immutable AccessRequest
    const manager = buildSessionManager()
    const aliceSession: AuthorizationAgent = await manager.getSession(aliceId)
    await waitForNeedBasedAccessRequestReceivedCompletion(aliceSession)
    const stored = await storedAccessRequests(aliceSession)
    expect(stored.length).toBe(1)
    expectRequestShape(stored[0], { grantee: bobId, grantedBy: bobId, dataOwner: aliceId })
  })

  test('full sequence — the RPC leg converges on the stored request', async () => {
    const response = await fetch(rpcEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: bobCookie,
      },
      body: JSON.stringify(
        rpcPayload({
          _tag: 'RequestAccessUsingAccessNeeds',
          dataOwner: aliceId,
          hasAccessNeedGroup: accessNeedGroup,
          context: bobId,
        })
      ),
    })
    expect(response.status).toBe(200)
    const { _tag, value } = (await response.json())[0]
    expect(_tag).toBe('Success')
    expect(value).toEqual({ accepted: true, activityId: expect.any(String) })

    const manager = buildSessionManager()
    const bobSession: AuthorizationAgent = await manager.getSession(bobId)
    const aliceSession: AuthorizationAgent = await manager.getSession(aliceId)
    // both sides completed — the requester forwarded (202), the owner stored
    await waitForNeedBasedAccessRequestSentCompletion(bobSession)
    await waitForNeedBasedAccessRequestReceivedCompletion(aliceSession)
    const stored = await storedAccessRequests(aliceSession)
    expect(stored.length).toBe(1)
    expectRequestShape(stored[0], { grantee: bobId, grantedBy: bobId, dataOwner: aliceId })
  })
})

