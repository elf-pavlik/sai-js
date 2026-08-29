import { createStatefulFetch } from '@janeirodigital/interop-test-utils'
import {
  INTEROP,
  LDP,
  RDF,
  SKOS,
  fetchJsonLd,
  toStore,
  withContext,
} from '@janeirodigital/interop-utils'
import { DataFactory } from 'n3'
import { describe, test } from 'vitest'
import { dataModelContext } from '../../src'
import { putRole, fromJsonLd as roleFromJsonLd } from '../../src/role'
import {
  fromJsonLd as invitationFromJsonLd,
  putSocialAgentInvitation,
} from '../../src/social-agent-invitation'
import { expect } from '../expect'

// ──────────────────────────
// Write-path round-trips for the models whose serialization was previously
// covered only implicitly (crud tests via the mock factory). Each one asserts
// the quads the shared dataModelContext produces for the model's RDF-backed
// fields (the toJsonLd → toStore pattern), and — for the raw-JSON-PUT models —
// a real PUT → read-back round-trip through the stateful fetch.
// ──────────────────────────

describe('role write path', () => {
  const iri = 'https://registry/alice/role/r1'
  const roleData = {
    id: iri,
    type: [INTEROP.Role],
    prefLabel: 'Test Role',
    members: ['https://id/bob'],
  }

  test('shared context serializes role fields to the expected quads', async () => {
    const store = await toStore(withContext(dataModelContext, roleData), iri)
    expect(store).toBeRdfDatasetContaining(
      DataFactory.quad(DataFactory.namedNode(iri), RDF.terms.type, INTEROP.terms.Role),
      DataFactory.quad(
        DataFactory.namedNode(iri),
        SKOS.terms.prefLabel,
        DataFactory.literal('Test Role')
      ),
      DataFactory.quad(
        DataFactory.namedNode(iri),
        INTEROP.terms.hasMember,
        DataFactory.namedNode('https://id/bob')
      )
    )
  })

  test('putRole round-trips through a stateful fetch', async () => {
    const fetch = createStatefulFetch()
    await putRole(roleData, fetch)
    const raw = await fetchJsonLd(iri, fetch)
    // the wire body is the expanded form: top-level array, no @context,
    // full-IRI property keys
    expect(Array.isArray(raw)).toBe(true)
    expect(JSON.stringify(raw)).not.toContain('@context')
    expect(JSON.stringify(raw)).toContain('http://www.w3.org/ns/solid/interop#hasMember')
    expect(await roleFromJsonLd(raw, iri)).toEqual(roleData)
  })
})

describe('social-agent-invitation write path', () => {
  const iri = 'https://registry/kim/agent/inv1'
  const invitationData = {
    id: iri,
    type: [INTEROP.SocialAgentInvitation],
    capabilityUrl: 'https://auth/.sai/invitations/some-secret',
    prefLabel: 'Bob',
    note: 'What about Bob?',
  }

  test('shared context serializes invitation fields to the expected quads', async () => {
    const store = await toStore(withContext(dataModelContext, invitationData), iri)
    expect(store).toBeRdfDatasetContaining(
      DataFactory.quad(
        DataFactory.namedNode(iri),
        RDF.terms.type,
        INTEROP.terms.SocialAgentInvitation
      ),
      DataFactory.quad(
        DataFactory.namedNode(iri),
        INTEROP.terms.hasCapabilityUrl,
        DataFactory.namedNode('https://auth/.sai/invitations/some-secret')
      ),
      DataFactory.quad(
        DataFactory.namedNode(iri),
        SKOS.terms.prefLabel,
        DataFactory.literal('Bob')
      ),
      DataFactory.quad(
        DataFactory.namedNode(iri),
        SKOS.terms.note,
        DataFactory.literal('What about Bob?')
      )
    )
  })

  test('putSocialAgentInvitation round-trips through a stateful fetch', async () => {
    const fetch = createStatefulFetch()
    await putSocialAgentInvitation(invitationData, fetch)
    expect(await invitationFromJsonLd(await fetchJsonLd(iri, fetch), iri)).toEqual(invitationData)
  })
})

describe('data-registration write path', () => {
  test('shared context serializes the registration fields to the expected quads', async () => {
    const iri = 'https://data/alice/reg/'
    const data = {
      id: iri,
      type: [INTEROP.DataRegistration, LDP.Resource],
      registeredShapeTree: 'https://trees/Project',
      contains: [],
    }
    const store = await toStore(withContext(dataModelContext, data), iri)
    expect(store).toBeRdfDatasetContaining(
      DataFactory.quad(DataFactory.namedNode(iri), RDF.terms.type, INTEROP.terms.DataRegistration),
      DataFactory.quad(
        DataFactory.namedNode(iri),
        INTEROP.terms.registeredShapeTree,
        DataFactory.namedNode('https://trees/Project')
      )
    )
  })
})

describe('application-registration write path', () => {
  test('shared context serializes the registration fields to the expected quads', async () => {
    const iri = 'https://registry/alice/agent/app1/'
    const data = {
      id: iri,
      type: [INTEROP.ApplicationRegistration, LDP.Resource],
      registeredAgent: 'https://id/test-client',
      hasDataGrant: ['https://registry/alice/grant/g1', 'https://registry/alice/grant/g2'],
    }
    const store = await toStore(withContext(dataModelContext, data), iri)
    expect(store).toBeRdfDatasetContaining(
      DataFactory.quad(
        DataFactory.namedNode(iri),
        RDF.terms.type,
        INTEROP.terms.ApplicationRegistration
      ),
      DataFactory.quad(
        DataFactory.namedNode(iri),
        INTEROP.terms.registeredAgent,
        DataFactory.namedNode('https://id/test-client')
      ),
      DataFactory.quad(
        DataFactory.namedNode(iri),
        INTEROP.terms.hasDataGrant,
        DataFactory.namedNode('https://registry/alice/grant/g1')
      ),
      DataFactory.quad(
        DataFactory.namedNode(iri),
        INTEROP.terms.hasDataGrant,
        DataFactory.namedNode('https://registry/alice/grant/g2')
      )
    )
  })
})
