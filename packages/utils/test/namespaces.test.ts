import { describe, expect, test } from 'vitest'
import { ACL, AS, INTEROP, RDF } from '../src/namespaces'

describe('vocabularies', () => {
  test('members are full IRIs as strings', () => {
    expect(INTEROP.hasDataRegistration).toBe(
      'http://www.w3.org/ns/solid/interop#hasDataRegistration'
    )
    expect(INTEROP.hasRegistrySet).toBe('http://www.w3.org/ns/solid/interop#hasRegistrySet')
    expect(ACL.Read).toBe('http://www.w3.org/ns/auth/acl#Read')
    expect(RDF.type).toBe('http://www.w3.org/1999/02/22-rdf-syntax-ns#type')
  })

  test('namespace is the vocabulary base IRI', () => {
    expect(INTEROP.namespace).toBe('http://www.w3.org/ns/solid/interop#')
    expect(ACL.namespace).toBe('http://www.w3.org/ns/auth/acl#')
  })

  test('terms exposes NamedNodes with the same values', () => {
    const term = INTEROP.terms.hasDataRegistration
    expect(term.termType).toBe('NamedNode')
    expect(term.value).toBe('http://www.w3.org/ns/solid/interop#hasDataRegistration')
    expect(ACL.terms.Read.value).toBe('http://www.w3.org/ns/auth/acl#Read')
  })

  test('AS is the ActivityStreams vocab with the as:actor term', () => {
    expect(AS.namespace).toBe('https://www.w3.org/ns/activitystreams#')
    expect(AS.actor).toBe('https://www.w3.org/ns/activitystreams#actor')
    expect(AS.object).toBe('https://www.w3.org/ns/activitystreams#object')
    expect(AS.Update).toBe('https://www.w3.org/ns/activitystreams#Update')
    expect(AS.terms.actor.value).toBe('https://www.w3.org/ns/activitystreams#actor')
  })

  test('activity class terms exist in INTEROP', () => {
    expect(INTEROP.InvitationAccepted).toBe('http://www.w3.org/ns/solid/interop#InvitationAccepted')
    expect(INTEROP.InvitationCreated).toBe('http://www.w3.org/ns/solid/interop#InvitationCreated')
    expect(INTEROP.AgentRegistrationAdded).toBe(
      'http://www.w3.org/ns/solid/interop#AgentRegistrationAdded'
    )
    expect(INTEROP.AdminAuthorizationRecorded).toBe(
      'http://www.w3.org/ns/solid/interop#AdminAuthorizationRecorded'
    )
    expect(INTEROP.AdminAuthorizationRevoked).toBe(
      'http://www.w3.org/ns/solid/interop#AdminAuthorizationRevoked'
    )
    expect(INTEROP.AuthorizationRecorded).toBe(
      'http://www.w3.org/ns/solid/interop#AuthorizationRecorded'
    )
    expect(INTEROP.AuthorizationRevoked).toBe(
      'http://www.w3.org/ns/solid/interop#AuthorizationRevoked'
    )
    expect(INTEROP.RoleMembershipChanged).toBe(
      'http://www.w3.org/ns/solid/interop#RoleMembershipChanged'
    )
    expect(INTEROP.RoleDeleted).toBe('http://www.w3.org/ns/solid/interop#RoleDeleted')
    expect(INTEROP.RoleCreated).toBe('http://www.w3.org/ns/solid/interop#RoleCreated')
    expect(INTEROP.DelegatedGrantsUpdated).toBe(
      'http://www.w3.org/ns/solid/interop#DelegatedGrantsUpdated'
    )
    expect(INTEROP.AuthorizationRequested).toBe(
      'http://www.w3.org/ns/solid/interop#AuthorizationRequested'
    )
    expect(INTEROP.ShareRequested).toBe('http://www.w3.org/ns/solid/interop#ShareRequested')
    expect(INTEROP.ActivityCompleted).toBe('http://www.w3.org/ns/solid/interop#ActivityCompleted')
  })
})
