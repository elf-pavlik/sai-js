import { INTEROP } from '@janeirodigital/interop-utils'
import { describe, expect, test, vi } from 'vitest'

// ──────────────────────────
// Mocks
// ──────────────────────────

/** The activity gets its session via buildSessionManager — stub it. */
const sessionMock = vi.hoisted(() => {
  let session: unknown
  return {
    setSession: (s: unknown) => {
      session = s
    },
    getSession: () => session,
  }
})

vi.mock('../src/builders/sessionManager.js', () => ({
  buildSessionManager: () => ({ getSession: async () => sessionMock.getSession() }),
}))

import { createSocialAgentInvitation } from '../src/temporal/activities/invitation.js'

// ──────────────────────────
// Fixtures
// ──────────────────────────

const INVITATION_REGISTRY = 'https://auth.example/invitation/'
const INVITATION_ID = 'https://auth.example/invitation/abc123'
const OWNER = 'https://alice.example/#id'

interface PutRecord {
  url: string
  body: Record<string, unknown>[]
}

/**
 * A fake session: its fetch serves the invitation registry listing (used by
 * loadSocialAgentInvitation's read path) and records PUTs. `registeredInvites`
 * lets a test pre-seed an existing invitation (the idempotency case) — the
 * read fetches the resource doc for a listed id, so the fake returns the doc
 * directly when the URL matches a registered invitation.
 */
function makeSession(registeredInvitations: string[] = []) {
  const puts: PutRecord[] = []
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'PUT') {
      puts.push({ url, body: JSON.parse(String(init.body)) })
      return new Response(null, { status: 201 })
    }
    // a registered invitation doc (the activity's own read of the id) or an
    // empty container listing — expanded JSON-LD either way
    const body = registeredInvitations.includes(url)
      ? [
          {
            '@id': url,
            'http://www.w3.org/1999/02/22-rdf-syntax-ns#type': [
              { '@id': INTEROP.SocialAgentInvitation },
            ],
            [INTEROP.hasCapabilityUrl]: [{ '@id': `https://auth.example/invitations/link.${url}` }],
            'http://www.w3.org/2004/02/skos/core#prefLabel': [{ '@value': 'Bob' }],
          },
        ]
      : [{ '@id': url }]
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/ld+json' },
    })
  })
  return {
    session: {
      registrySet: { hasInvitationRegistry: { id: INVITATION_REGISTRY } },
      fetch,
    },
    puts,
  }
}

function capabilityUrlOf(put: PutRecord): string {
  const node = put.body
  const capabilityUrl = node[0][INTEROP.hasCapabilityUrl] as { '@id'?: string; '@value'?: string }[]
  // the context types capabilityUrl as an IRI term — expanded to `@id`
  return (capabilityUrl[0]['@id'] ?? capabilityUrl[0]['@value']) as string
}

function prefLabelOf(put: PutRecord): string {
  const node = put.body
  const prefLabel = node[0]['http://www.w3.org/2004/02/skos/core#prefLabel'] as {
    '@value': string
  }[]
  return prefLabel[0]['@value'] as string
}

// ──────────────────────────
// Tests
// ──────────────────────────

describe('createSocialAgentInvitation (activity-first step 1)', () => {
  test('PUTs the invitation at the pre-minted id with a generated capabilityUrl', async () => {
    const { session, puts } = makeSession()
    sessionMock.setSession(session)
    await createSocialAgentInvitation(OWNER, {
      id: INVITATION_ID,
      type: [INTEROP.SocialAgentInvitation],
      prefLabel: 'Bob',
      note: 'Some note',
    })

    expect(puts).toHaveLength(1)
    const put = puts[0] as PutRecord
    expect(put.url).toBe(INVITATION_ID)
    // the id, the class + the flat fields ride the expanded wire form —
    // `type` expands to @type (context: type → @type)
    expect(put.body[0]['@id']).toBe(INVITATION_ID)
    expect(put.body[0]['@type']).toContain(INTEROP.SocialAgentInvitation)
    expect(prefLabelOf(put)).toBe('Bob')
    // the capabilityUrl is generated here in the workflow (never the RPC) —
    // the opaque `.sai/invitations/{base64url(webId)}.{uuid}` link
    expect(capabilityUrlOf(put)).toMatch(/^.*\.sai\/invitations\/.+\./)
  })

  test('skips the write when the invitation already exists at the pre-minted id (retry/reconcile)', async () => {
    const { session, puts } = makeSession([INVITATION_ID])
    sessionMock.setSession(session)
    await createSocialAgentInvitation(OWNER, {
      id: INVITATION_ID,
      type: [INTEROP.SocialAgentInvitation],
      prefLabel: 'Bob',
      note: 'Some note',
    })

    // find-first by the stable pre-minted id — a re-delivery (workflow retry
    // or the reconcile sweep) must never double-PUT a second invitation
    expect(puts).toHaveLength(0)
  })
})