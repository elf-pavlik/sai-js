import { ActivityRegistry } from '@janeirodigital/interop-authorization-agent'
import { dataModelContext } from '@janeirodigital/interop-data-model'
import { describe, test } from 'vitest'
import { expect } from './expect'

// payload-contract-alignment flip: JSON-LD `@type` is an unordered set — the
// SPARQL-backed store may frame it back in ANY order (the dagger runs showed
// `["AuthorizationGranted", "Activity"]`). loadActivity must discriminate by
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
      '@type': ["AuthorizationGranted", "Activity"],
      actor: 'https://id/alice',
      target: 'https://registry/alice/authorization/',
      // embedded single-DA form (the legacy live-link string[] form was
      // dropped — refinement §5.1)
      object: [
        {
          '@id': 'https://registry/alice/authorization/o1',
          '@type': ['http://www.w3.org/ns/solid/interop#DataAuthorization'],
          grantee: 'https://id/bob',
          grantedBy: 'https://id/alice',
          registeredShapeTree: 'https://data/shapetrees/trees/Project',
          scopeOfAuthorization: 'http://www.w3.org/ns/solid/interop#SelectedFromRegistry',
          dataOwner: 'https://id/alice',
          hasDataRegistration: 'https://data/alice-home/',
          accessMode: ['http://www.w3.org/ns/auth/acl#Read'],
        },
      ],
      createdAt: '2024-01-01T00:00:00.000Z',
    }
    const activity = await ActivityRegistry.loadActivity(
      'https://registry/alice/activity/abc',
      mockFetch(doc)
    )
    expect(activity.type).toEqual(['Activity', 'AuthorizationGranted'])
    expect(activity.actor).toBe('https://id/alice')
    expect(activity.object).toEqual([
      expect.objectContaining({ id: 'https://registry/alice/authorization/o1' }),
    ])
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
        label: 'Dan',
      },
      createdAt: '2024-01-01T00:00:00.000Z',
    }
    const activity = await ActivityRegistry.loadActivity(
      'https://registry/kim/activity/xyz',
      mockFetch(doc)
    )
    expect(activity.type).toEqual(['Activity', 'InvitationAccepted', 'as:Accept'])
    expect((activity as { object: { label: string } }).object.label).toBe('Dan')
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

  test('embeds the denied-authorization structure snapshot (AuthorizationDenied — Step 4)', async () => {
    const doc = {
      '@context': dataModelContext,
      '@id': 'https://registry/bob/activity/deny',
      '@type': ['Activity', 'AuthorizationDenied'],
      actor: 'https://id/bob',
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
    expect(activity.type).toEqual(['Activity', 'AuthorizationDenied'])
    // a single rdf:type frames as a scalar — normalized back to string[]
    expect((activity as { object: { type: string[] } }).object.type).toEqual([
      'http://www.w3.org/ns/solid/interop#AuthorizationStructure',
    ])
    expect(
      (activity as { object: { grantee: string } }).object.grantee
    ).toBe('https://data/test-client/public/id')
  })

  test('embeds the granted DataAuthorization POJOs-to-be (activity-first step 2)', async () => {
    const doc = {
      '@context': dataModelContext,
      '@id': 'https://registry/alice/activity/grant',
      '@type': ['Activity', 'AuthorizationGranted'],
      actor: 'https://id/alice',
      target: 'https://registry/alice/authorization/',
      object: [
        {
          '@id': 'https://registry/alice/authorization/da-1',
          '@type': ['http://www.w3.org/ns/solid/interop#DataAuthorization'],
          grantee: 'https://id/bob',
          grantedBy: 'https://id/alice',
          registeredShapeTree: 'https://data/shapetrees/pm#Project',
          scopeOfAuthorization: 'http://www.w3.org/ns/solid/interop#AllFromRegistry',
          dataOwner: 'https://id/alice',
          hasDataRegistration: 'https://data/alice/project/',
          satisfiesAccessNeed: 'https://data/shapetrees/pm#need-project',
          accessMode: ['http://www.w3.org/ns/auth/acl#Read'],
          hasInheritingAuthorization: ['https://registry/alice/authorization/da-1-child'],
        },
        {
          '@id': 'https://registry/alice/authorization/da-1-child',
          '@type': ['http://www.w3.org/ns/solid/interop#DataAuthorization'],
          grantee: 'https://id/bob',
          grantedBy: 'https://id/alice',
          registeredShapeTree: 'https://data/shapetrees/task#Task',
          scopeOfAuthorization: 'http://www.w3.org/ns/solid/interop#Inherited',
          dataOwner: 'https://id/alice',
          inheritsFromAuthorization: 'https://registry/alice/authorization/da-1',
          accessMode: ['http://www.w3.org/ns/auth/acl#Write'],
        },
      ],
      createdAt: '2024-01-01T00:00:00.000Z',
    }
    const activity = (await ActivityRegistry.loadActivity(
      'https://registry/alice/activity/grant',
      mockFetch(doc)
    )) as unknown as {
      type: string[]
      object: {
        id: string
        grantee: string
        scopeOfAuthorization: string
        satisfiesAccessNeed?: string
        hasInheritingAuthorization?: string[]
        inheritsFromAuthorization?: string
      }[]
    }
    expect(activity.type).toEqual(['Activity', 'AuthorizationGranted'])
    expect(activity.object).toHaveLength(2)
    // each embedded node decodes to a DataAuthorizationData POJO at its real id
    expect(activity.object[0].id).toBe('https://registry/alice/authorization/da-1')
    expect(activity.object[0].grantee).toBe('https://id/bob')
    expect(activity.object[0].scopeOfAuthorization).toBe(
      'http://www.w3.org/ns/solid/interop#AllFromRegistry'
    )
    // the @reverse term does NOT resolve on nested embedded nodes — the
    // workflow materializes parents and children separately; the child's
    // forward `inheritsFromAuthorization` (below) re-links them in the store
    expect(activity.object[1].id).toBe('https://registry/alice/authorization/da-1-child')
    expect(activity.object[1].inheritsFromAuthorization).toBe(
      'https://registry/alice/authorization/da-1'
    )
  })

  test('embeds a SINGLE granted DataAuthorization POJO-to-be (share — one DA per activity)', async () => {
    // a single embedded node frames as an OBJECT, not an array — the decoder
    // must detect the DA rdf:type and wrap it (share writes one DA per
    // grantee; regression: the share flow timed out because the snapshot
    // branch swallowed the DA and the workflow never materialized)
    const doc = {
      '@context': dataModelContext,
      '@id': 'https://registry/alice/activity/share-single',
      '@type': ['Activity', 'AuthorizationGranted'],
      actor: 'https://id/alice',
      target: 'https://registry/alice/authorization/',
      object: {
        '@id': 'https://registry/alice/authorization/da-share-1',
        '@type': ['http://www.w3.org/ns/solid/interop#DataAuthorization'],
        grantee: 'https://id/kim',
        grantedBy: 'https://id/alice',
        registeredShapeTree: 'https://data/shapetrees/trees/Project',
        scopeOfAuthorization: 'http://www.w3.org/ns/solid/interop#SelectedFromRegistry',
        dataOwner: 'https://id/alice',
        hasDataRegistration: 'https://data/alice-home/',
        accessMode: ['http://www.w3.org/ns/auth/acl#Read'],
        hasDataInstance: 'https://data/alice-home/x1n3cm/n8k3wp',
      },
      createdAt: '2024-01-01T00:00:00.000Z',
    }
    const activity = (await ActivityRegistry.loadActivity(
      'https://registry/alice/activity/share-single',
      mockFetch(doc)
    )) as unknown as {
      type: string[]
      object: { grantee: string; scopeOfAuthorization: string; hasDataInstance?: string[] }[]
    }
    expect(activity.type).toEqual(['Activity', 'AuthorizationGranted'])
    expect(activity.object).toHaveLength(1)
    expect(activity.object[0].grantee).toBe('https://id/kim')
    expect(activity.object[0].scopeOfAuthorization).toBe(
      'http://www.w3.org/ns/solid/interop#SelectedFromRegistry'
    )
    expect(activity.object[0].hasDataInstance).toEqual([
      'https://data/alice-home/x1n3cm/n8k3wp',
    ])
  })

  test('embeds the InvitationCreated object — the invitation-to-be POJO with type normalized', async () => {
    const doc = {
      '@context': dataModelContext,
      '@id': 'https://registry/dan/activity/create',
      '@type': ['Activity', 'InvitationCreated', 'as:Create'],
      actor: 'https://id/dan',
      // no target — the invitation id rides the embedded object
      // (a single rdf:type frames as a scalar — normalized back to string[])
      object: {
        '@id': 'https://registry/dan/invitation/abc',
        '@type': 'http://www.w3.org/ns/solid/interop#SocialAgentInvitation',
        label: 'Kim',
        note: 'Some note',
      },
      createdAt: '2024-01-01T00:00:00.000Z',
    }
    const activity = await ActivityRegistry.loadActivity(
      'https://registry/dan/activity/create',
      mockFetch(doc)
    )
    expect(activity.type).toEqual(['Activity', 'InvitationCreated', 'as:Create'])
    expect(activity.object).toEqual({
      id: 'https://registry/dan/invitation/abc',
      type: ['http://www.w3.org/ns/solid/interop#SocialAgentInvitation'],
      label: 'Kim',
      note: 'Some note',
    })
    // no flat activity-level label/note leaked from the old shape
    expect((activity as Record<string, unknown>).label).toBeUndefined()
    expect((activity as Record<string, unknown>).note).toBeUndefined()
    // no target — dropped with the embedded object form
    expect((activity as Record<string, unknown>).target).toBeUndefined()
  })
})