import { INTEROP, LDP } from '@janeirodigital/interop-utils'
import { describe, test } from 'vitest'
import { fromJsonLd as registrationFromJsonLd } from '../../src/social-agent-registration'
import { expect } from '../expect'
import { docFromGraphs } from './helpers'

const REGISTRATION_IRI = 'https://registry/acme/social-agent/je0s7n/'

// Graph <meta:https://registry/acme/social-agent/je0s7n/> in registry.trig: a
// SocialAgentRegistration with registeredAgent, reciprocalRegistration,
// hasDataGrant, skos:prefLabel and skos:note.
describe('SocialAgentRegistration framing', () => {
  test('frames the social agent registration graph into SocialAgentRegistrationData', async () => {
    const doc = await docFromGraphs([`meta:${REGISTRATION_IRI}`])
    const registration = await registrationFromJsonLd(doc, REGISTRATION_IRI)
    expect(registration).toEqual({
      id: REGISTRATION_IRI,
      type: [INTEROP.SocialAgentRegistration, LDP.Resource],
      registeredAgent: 'https://id/alice',
      hasDataGrant: ['https://registry/acme/grant/g4yhtm'],
      hasAdminGrant: [],
      label: 'Alice',
      note: 'Chasing white rabits.',
      hasAccessNeedGroup: undefined,
      reciprocalRegistration: 'https://registry/alice/social-agent/cp9g7p/',
    })
  })
})
