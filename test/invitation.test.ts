import { buildOidcSession, buildSessionManager } from '@elfpavlik/sai-components'
import type { AuthorizationAgent } from '@janeirodigital/interop-authorization-agent'
import { describe, expect, test } from 'vitest'
import {
  rpcPayload,
  waitFor,
  waitForAgentRegistrationAddedCompletion,
  waitForInvitationAcceptedCompletion,
} from './util'

const rpcEndpoint = 'https://auth/.sai/api'

const danId = 'https://id/dan'
const danCookie = 'css-account=4f8fe6e4-4a5a-4318-93f6-d8645778fc28'
const kimId = 'https://id/kim'
const kimCookie = 'css-account=77b0674a-1f3b-4c78-a7d9-0b2e3f4a5b6c'
const yoyoId = 'https://id/yoyo'

/**
 * Wait until `session` has a registration of `peerId` whose reciprocal link is
 * set — the acceptor's `acceptInvitation` workflow and the inviter's
 * `establishReciprocal` each set one side.
 */
async function waitForReciprocalRegistration(
  session: AuthorizationAgent,
  peerId: string
): Promise<void> {
  await waitFor(
    async () => {
      const registration = await session.findSocialAgentRegistration(peerId)
      return registration?.reciprocalRegistration
    },
    { timeout: 30_000 }
  )
}

// ──────────────────────────────────────────────────────────────────────────
// Personal flow — one long create + accept chain. Dan invites Kim directly
// (dan↔kim has NO seeded relationship in registry.trig — unlike alice↔bob),
// so the accept runs the full chain.
// ──────────────────────────────────────────────────────────────────────────
describe('personal invitation', () => {
  test('dan creates invitation, kim accepts — invitationAccepted completes', async () => {
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

    // Dan passes the link out of band — Kim accepts it (pending acknowledgment;
    // the acceptance completes via Kim's invitationAccepted workflow)
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
    expect(accept.value).toEqual({ accepted: true })

    // acceptor side (Kim's acceptInvitation workflow): kim → dan + reciprocal
    const manager = buildSessionManager()
    const kimSession = await manager.getSession(kimId)
    await waitForReciprocalRegistration(kimSession, danId)

    // inviter side (via the workflow's capabilityUrl POST + Dan's
    // establishReciprocal): dan → kim + reciprocal
    const danSession = await manager.getSession(danId)
    await waitForReciprocalRegistration(danSession, kimId)

    // both sides marked their activity done
    await waitForInvitationAcceptedCompletion(kimSession)
    await waitForAgentRegistrationAddedCompletion(danSession)
  })
})

// ──────────────────────────────────────────────────────────────────────────
// Admin send (admin-invitation-send view): Dan — as YoYo admin — invites Kim.
// The org and Kim have no seeded relationship, so the accept runs the full
// chain.
// ──────────────────────────────────────────────────────────────────────────
describe('admin invitation send', () => {
  test('dan invites kim to yoyo; kim accepts — invitationAccepted completes', async () => {
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

    // Kim accepts the invitation to the org — pending acknowledgment
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
    expect(accept.value).toEqual({ accepted: true })

    // acceptor side (Kim's acceptInvitation workflow): kim → yoyo + reciprocal
    const manager = buildSessionManager()
    const kimSession = await manager.getSession(kimId)
    await waitForReciprocalRegistration(kimSession, yoyoId)

    // inviter side (via the capabilityUrl POST + YoYo's establishReciprocal):
    // yoyo → kim + reciprocal
    const yoyoSession = await manager.getSession(yoyoId)
    await waitForReciprocalRegistration(yoyoSession, kimId)

    // both sides marked their activity done
    await waitForInvitationAcceptedCompletion(kimSession)
    await waitForAgentRegistrationAddedCompletion(yoyoSession)
  })
})

// ──────────────────────────────────────────────────────────────────────────
// Admin receive (admin-invitation-receive view): Kim invites YoYo, passes the
// link to Dan, who accepts in the YoYo org context. The org and Kim have no
// seeded relationship, so the accept runs the full chain as YoYo's own
// invitationAccepted workflow.
// ──────────────────────────────────────────────────────────────────────────
describe('admin invitation receive', () => {
  test('kim invites yoyo; dan accepts in org context — invitationAccepted completes', async () => {
    // Kim creates the invitation for YoYo
    const createResponse = await fetch(rpcEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: kimCookie,
      },
      body: JSON.stringify(
        rpcPayload({
          _tag: 'CreateInvitation',
          label: 'YoYo',
          note: 'Some note',
          context: kimId,
        })
      ),
    })
    expect(createResponse.status).toBe(200)
    const createBody = await createResponse.json()
    const create = createBody[0]
    expect(create._tag).toBe('Success')
    expect(create.value).toEqual(expect.objectContaining({ label: 'YoYo', note: 'Some note' }))
    expect(create.value.capabilityUrl).toMatch('https://auth/.sai/invitations')

    // Dan (YoYo admin) accepts the invitation to the org — pending
    // acknowledgment; the acceptance completes via YoYo's invitationAccepted
    // workflow (the admin's UAS only records the activity)
    const acceptResponse = await fetch(rpcEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: danCookie,
      },
      body: JSON.stringify(
        rpcPayload({
          _tag: 'AcceptInvitation',
          capabilityUrl: create.value.capabilityUrl,
          label: 'Kim',
          note: 'Beep boop',
          context: yoyoId,
        })
      ),
    })
    expect(acceptResponse.status).toBe(200)
    const acceptBody = await acceptResponse.json()
    const accept = acceptBody[0]
    expect(accept._tag).toBe('Success')
    expect(accept.value).toEqual({ accepted: true })

    // acceptor side (YoYo's acceptInvitation workflow, running as YoYo):
    // yoyo → kim + reciprocal
    const manager = buildSessionManager()
    const yoyoSession = await manager.getSession(yoyoId)
    await waitForReciprocalRegistration(yoyoSession, kimId)

    // inviter side (via the capabilityUrl POST as YoYo + Kim's
    // establishReciprocal): kim → yoyo + reciprocal
    const kimSession = await manager.getSession(kimId)
    await waitForReciprocalRegistration(kimSession, yoyoId)

    // both sides marked their activity done
    await waitForInvitationAcceptedCompletion(yoyoSession)
    await waitForAgentRegistrationAddedCompletion(kimSession)

    // regression guard — the old bug created a spurious kim → dan pair
    expect(await kimSession.findSocialAgentRegistration(danId)).toBeUndefined()
  })
})