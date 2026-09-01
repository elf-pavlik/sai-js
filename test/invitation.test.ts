import { buildOidcSession, buildSessionManager } from '@elfpavlik/sai-components'
import { describe, expect, test } from 'vitest'
import { rpcPayload, waitFor, waitForAgentRegistrationAddedCompletion } from './util'

const rpcEndpoint = 'https://auth/.sai/api'
const kimId = 'https://id/kim'

// ──────────────────────────────────────────────────────────────────────────
// Personal flow — one long create + accept chain. Dan invites Kim directly
// (dan↔kim has NO seeded relationship in registry.trig — unlike alice↔bob),
// so the accept runs the full establishReciprocal chain.
// ──────────────────────────────────────────────────────────────────────────
describe('invitation', () => {
  const danId = 'https://id/dan'
  const danCookie = 'css-account=4f8fe6e4-4a5a-4318-93f6-d8645778fc28'
  const kimCookie = 'css-account=77b0674a-1f3b-4c78-a7d9-0b2e3f4a5b6c'

  test('dan creates invitation, kim accepts — establishReciprocal completes', async () => {
    // Dan creates the invitation for Kim
    const createResponse = await fetch(rpcEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: danCookie,
      },
      body: JSON.stringify(
        rpcPayload({
          _tag: 'CreateInvitation',
          label: 'Kim',
          note: 'Some note',
          context: danId,
        })
      ),
    })
    expect(createResponse.status).toBe(200)
    const createBody = await createResponse.json()
    const create = createBody[0]
    expect(create._tag).toBe('Success')
    expect(create.value).toEqual(expect.objectContaining({ label: 'Kim', note: 'Some note' }))
    expect(create.value.capabilityUrl).toMatch('https://auth/.sai/invitations')

    // verify the invitation resource with dan's own session
    const session = await buildOidcSession(danId)
    const check = await session.authFetch(create.value.id)
    expect(check.status).toBe(200)
    // TODO: validate data using SocialAgentInvitation shape

    // Dan passes the link out of band — Kim accepts it
    const acceptResponse = await fetch(rpcEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: kimCookie,
      },
      body: JSON.stringify(
        rpcPayload({
          _tag: 'AcceptInvitation',
          capabilityUrl: create.value.capabilityUrl,
          label: 'Dan',
          note: 'Beep boop',
          context: kimId,
        })
      ),
    })
    expect(acceptResponse.status).toBe(200)
    const acceptBody = await acceptResponse.json()
    const accept = acceptBody[0]
    expect(accept._tag).toBe('Success')
    expect(accept.value.id).toBe(danId)
    expect(accept.value).toEqual(expect.objectContaining({ label: 'Dan', note: 'Beep boop' }))

    // Kim registered Dan during accept (fresh — no seeded relationship)
    const manager = buildSessionManager()
    const kimSession = await manager.getSession(kimId)
    const registration = await kimSession.findSocialAgentRegistration(danId)
    expect(registration).toBeDefined()
    // TODO: validate data using SocialAgentRegistration shape

    // CSS delivers the agentRegistrationAdded Add (Phase 2) — wait for the
    // reciprocal link, the establishReciprocal workflow outcome on dan's side
    const danSession = await manager.getSession(danId)
    await waitFor(async () => {
      const danRegForKim = await danSession.findSocialAgentRegistration(kimId)
      return danRegForKim?.reciprocalRegistration
    })

    // establishReciprocal marked the agentRegistrationAdded activity done — a
    // completion activity referencing it exists in dan's Activity Registry
    await waitForAgentRegistrationAddedCompletion(danSession)
  })
})

// ──────────────────────────────────────────────────────────────────────────
// Admin variant (admin-invitation view): Dan — as YoYo admin — invites Kim.
// The org and Kim have no seeded relationship, so the accept runs the full
// establishReciprocal chain.
// ──────────────────────────────────────────────────────────────────────────
describe('admin invitation', () => {
  const danId = 'https://id/dan'
  const danCookie = 'css-account=4f8fe6e4-4a5a-4318-93f6-d8645778fc28'
  const kimCookie = 'css-account=77b0674a-1f3b-4c78-a7d9-0b2e3f4a5b6c'
  const yoyoId = 'https://id/yoyo'

  test('dan invites kim to yoyo; kim accepts — establishReciprocal completes', async () => {
    // Dan (YoYo admin) creates the invitation for Kim in the org context
    const createResponse = await fetch(rpcEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: danCookie,
      },
      body: JSON.stringify(
        rpcPayload({
          _tag: 'CreateInvitation',
          label: 'Kim',
          note: 'Some note',
          context: yoyoId,
        })
      ),
    })
    expect(createResponse.status).toBe(200)
    const createBody = await createResponse.json()
    const create = createBody[0]
    expect(create._tag).toBe('Success')
    expect(create.value).toEqual(expect.objectContaining({ label: 'Kim', note: 'Some note' }))
    expect(create.value.capabilityUrl).toMatch('https://auth/.sai/invitations')

    // Kim accepts the invitation to the org
    const acceptResponse = await fetch(rpcEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: kimCookie,
      },
      body: JSON.stringify(
        rpcPayload({
          _tag: 'AcceptInvitation',
          capabilityUrl: create.value.capabilityUrl,
          label: 'YoYo',
          note: 'Beep boop',
          context: kimId,
        })
      ),
    })
    expect(acceptResponse.status).toBe(200)
    const acceptBody = await acceptResponse.json()
    const accept = acceptBody[0]
    expect(accept._tag).toBe('Success')
    expect(accept.value.id).toBe(yoyoId)
    expect(accept.value).toEqual(expect.objectContaining({ label: 'YoYo', note: 'Beep boop' }))

    // Kim's registration of YoYo (fresh — no seeded relationship)
    const manager = buildSessionManager()
    const kimSession = await manager.getSession(kimId)
    const registration = await kimSession.findSocialAgentRegistration(yoyoId)
    expect(registration).toBeDefined()
    // TODO: validate data using SocialAgentRegistration shape

    // CSS delivers the agentRegistrationAdded Add (Phase 2) — wait for the
    // reciprocal link, the establishReciprocal workflow outcome on the org side
    const yoyoSession = await manager.getSession(yoyoId)
    await waitFor(async () => {
      const yoyoRegForKim = await yoyoSession.findSocialAgentRegistration(kimId)
      return yoyoRegForKim?.reciprocalRegistration
    })

    // establishReciprocal marked the agentRegistrationAdded activity done — a
    // completion activity referencing it exists in YoYo's Activity Registry
    await waitForAgentRegistrationAddedCompletion(yoyoSession)
  })
})
