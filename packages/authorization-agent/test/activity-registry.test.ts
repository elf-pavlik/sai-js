import { ActivityRegistry } from '@janeirodigital/interop-authorization-agent'
import { dataModelContext } from '@janeirodigital/interop-data-model'
import { describe, test } from 'vitest'
import { expect } from './expect'

// payload-contract-alignment flip: JSON-LD `@type` is an unordered set — the
// SPARQL-backed store may frame it back in ANY order (the dagger runs showed
// `['AuthorizationRecorded', 'Activity']`). loadActivity must discriminate by
// set membership and canonicalize the tuple, or every consumer (handler
// decode, pending filters, the events bus) breaks.

function mockFetch(doc: Record<string, unknown>): (url: string) => Promise<Response> {
  return async (url: string) =>
    ({
      ok: true,
      status: 200,
      headers: { get: () => 'application/ld+json' },
      json: async () => doc,
    }) as unknown as Response
}

describe('ActivityRegistry.loadActivity — unordered type set', () => {
  test('canonicalizes a reversed class tuple', async () => {
    // the store returned the types in reverse of the write order
    const doc = {
      '@context': dataModelContext,
      '@id': 'https://registry/alice/activity/abc',
      '@type': ['AuthorizationRecorded', 'Activity'],
      actor: 'https://id/alice',
      target: 'https://registry/alice/authorization/',
      object: ['https://registry/alice/authorization/o1'],
      createdAt: '2024-01-01T00:00:00.000Z',
    }
    const activity = await ActivityRegistry.loadActivity(
      'https://registry/alice/activity/abc',
      mockFetch(doc)
    )
    expect(activity.type).toEqual(['Activity', 'AuthorizationRecorded'])
    expect(activity.actor).toBe('https://id/alice')
    expect(activity.object).toEqual(['https://registry/alice/authorization/o1'])
  })

  test('reorders an ASV-bearing reversed tuple (class first, not position-bound)', async () => {
    const doc = {
      '@context': dataModelContext,
      '@id': 'https://registry/kim/activity/xyz',
      '@type': ['as:Accept', 'InvitationAccepted', 'Activity'],
      actor: 'https://id/kim',
      target: 'https://registry/kim/',
      object: {
        '@id': 'urn:uuid:00000000-0000-0000-0000-000000000000',
        '@type': ['SocialAgentInvitation'],
        capabilityUrl: 'https://auth/.sai/invitations/abc',
        prefLabel: 'Dan',
      },
      createdAt: '2024-01-01T00:00:00.000Z',
    }
    const activity = await ActivityRegistry.loadActivity(
      'https://registry/kim/activity/xyz',
      mockFetch(doc)
    )
    expect(activity.type).toEqual(['Activity', 'InvitationAccepted', 'as:Accept'])
    expect((activity as { object: { prefLabel: string } }).object.prefLabel).toBe('Dan')
  })

  test('recognizes the completion class in any order', async () => {
    const doc = {
      '@context': dataModelContext,
      '@id': 'https://registry/alice/activity/done',
      '@type': ['ActivityCompleted', 'Activity'],
      target: 'https://registry/alice/activity/abc',
      createdAt: '2024-01-01T00:00:00.000Z',
    }
    const activity = await ActivityRegistry.loadActivity(
      'https://registry/alice/activity/done',
      mockFetch(doc)
    )
    expect(activity.type).toEqual(['Activity', 'ActivityCompleted'])
    expect(activity.target).toBe('https://registry/alice/activity/abc')
  })

  test('embeds a revoked-admin snapshot object (RPC deleted the resource)', async () => {
    const doc = {
      '@context': dataModelContext,
      '@id': 'https://registry/yoyo/activity/rev',
      '@type': ['Activity', 'AdminAuthorizationRevoked'],
      actor: 'https://id/yoyo',
      target: 'https://registry/yoyo/authorization/',
      object: {
        '@id': 'urn:uuid:11111111-2222-3333-4444-555555555555',
        '@type': ['http://www.w3.org/ns/solid/interop#AdminAuthorization'],
        grantee: 'https://id/bob',
        grantedBy: 'https://id/yoyo',
        scopeOfAuthorization: 'http://www.w3.org/ns/solid/interop#All',
      },
      createdAt: '2024-01-01T00:00:00.000Z',
    }
    const activity = await ActivityRegistry.loadActivity(
      'https://registry/yoyo/activity/rev',
      mockFetch(doc)
    )
    expect(activity.type).toEqual(['Activity', 'AdminAuthorizationRevoked'])
    expect(
      (activity as { object: { grantee: string } }).object.grantee
    ).toBe('https://id/bob')
  })

  test('embeds the denied-authorization structure snapshot (no DataAuthorization created)', async () => {
    const doc = {
      '@context': dataModelContext,
      '@id': 'https://registry/bob/activity/deny',
      '@type': ['Activity', 'AuthorizationRecorded'],
      actor: 'https://id/bob',
      target: 'https://registry/bob/authorization/',
      object: {
        '@id': 'urn:uuid:aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
        '@type': ['http://www.w3.org/ns/solid/interop#AuthorizationStructure'],
        grantee: 'https://data/test-client/public/id',
        hasAccessNeedGroup: 'https://data/test-client/public/access-needs#need-group-pm',
      },
      createdAt: '2024-01-01T00:00:00.000Z',
    }
    const activity = await ActivityRegistry.loadActivity(
      'https://registry/bob/activity/deny',
      mockFetch(doc)
    )
    expect(activity.type).toEqual(['Activity', 'AuthorizationRecorded'])
    // a single rdf:type frames as a scalar — normalized back to string[]
    expect((activity as { object: { type: string[] } }).object.type).toEqual([
      'http://www.w3.org/ns/solid/interop#AuthorizationStructure',
    ])
    expect(
      (activity as { object: { grantee: string } }).object.grantee
    ).toBe('https://data/test-client/public/id')
  })
})