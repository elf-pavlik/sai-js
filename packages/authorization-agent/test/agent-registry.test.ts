import { randomUUID } from 'node:crypto'
import { AgentRegistry } from '@janeirodigital/interop-authorization-agent'
import { fetch } from '@janeirodigital/interop-test-utils'
import { describe, test } from 'vitest'
import { expect } from './expect'

const webId = 'https://alice.example/#id'
const agentId = 'https://jarvis.alice.example/#agent'
const deps = { fetch, randomUUID }
const snippetIri = 'https://auth.alice.example/1cf3e08b-ffe2-465a-ac5b-94ce165cb8f0'

test('should provide applicationRegistrations', async () => {
  const registry = await { id: snippetIri }
  let count = 0
  for await (const authorization of AgentRegistry.applicationRegistrations(registry, deps.fetch)) {
    count += 1
    expect(authorization).toHaveProperty('id')
    expect(authorization).toHaveProperty('registeredAgent')
  }
  expect(count).toBe(2)
})

test('should provide socialAgentRegistrations', async () => {
  const registry = await { id: snippetIri }
  let count = 0
  for await (const authorization of AgentRegistry.socialAgentRegistrations(registry, deps.fetch)) {
    count += 1
    expect(authorization).toHaveProperty('id')
    expect(authorization).toHaveProperty('registeredAgent')
  }
  expect(count).toBe(2)
})

// TODO: update snippets with some invitations
test('should provide socialAgentInvitations', async () => {
  const registry = await { id: snippetIri }
  let count = 0
  for await (const invitation of AgentRegistry.socialAgentInvitations(registry, deps.fetch)) {
    count += 1
    expect(invitation).toHaveProperty('capabilityUrl')
  }
  expect(count).toBe(0)
})

describe('findApplicationRegistration', () => {
  test('finds application registration', async () => {
    const applicationIri = 'https://projectron.example/#app'
    const registry = await { id: snippetIri }
    expect(
      await AgentRegistry.findApplicationRegistration(registry, deps.fetch, applicationIri)
    ).toHaveProperty('registeredAgent', applicationIri)
  })
})

describe('findSocialAgentRegistration', () => {
  test('finds social agent registration', async () => {
    const socialAgentIri = 'https://acme.example/#corp'
    const registry = await { id: snippetIri }
    expect(
      await AgentRegistry.findSocialAgentRegistration(registry, deps.fetch, socialAgentIri)
    ).toHaveProperty('registeredAgent', socialAgentIri)
  })
})

// TODO: update snippets with some invitations
describe.skip('findSocialAgentInvitation', () => {
  test('finds social agent invitation', async () => {
    const socialAgentInvitationIri = 'TODO'
    const registry = await { id: snippetIri }
    expect(
      await AgentRegistry.findSocialAgentInvitation(registry, deps.fetch, socialAgentInvitationIri)
    ).toHaveProperty('capabilityUrl')
  })
})

describe('findRegistration', () => {
  test('finds application registration', async () => {
    const applicationIri = 'https://projectron.example/#app'
    const registry = await { id: snippetIri }
    expect(
      await AgentRegistry.findRegistration(registry, deps.fetch, applicationIri)
    ).toHaveProperty('registeredAgent', applicationIri)
  })

  test('finds social agent registration', async () => {
    const socialAgentIri = 'https://acme.example/#corp'
    const registry = await { id: snippetIri }
    expect(
      await AgentRegistry.findRegistration(registry, deps.fetch, socialAgentIri)
    ).toHaveProperty('registeredAgent', socialAgentIri)
  })
})

describe('addSocialAgentRegistration', () => {
  const jane = 'https://jane.example'

  test('throws if registration already exists', async () => {
    const socialAgentIri = 'https://acme.example/#corp'
    const registry = await { id: snippetIri }
    expect(
      AgentRegistry.addSocialAgentRegistration(
        registry,
        deps,
        { agent: webId, client: agentId },
        socialAgentIri,
        'Someone'
      )
    ).rejects.toThrow('already exists')
  })

  test.skip('returns added registration', async () => {
    const registry = await { id: snippetIri }
    const registration = await AgentRegistry.addSocialAgentRegistration(
      registry,
      factory,
      { agent: webId, client: agentId },
      jane,
      'Jane'
    )
    expect(registration.registeredAgent).toBe(jane)
  })
})

describe('addSocialAgentInvitation', () => {
  const capabilityUrl = 'https://auth.jane.example/some-secret-url'

  test.skip('throws if invitation already exists', async () => {
    const registry = await { id: snippetIri }
    expect(
      AgentRegistry.addSocialAgentInvitation(registry, deps, capabilityUrl, 'Someone')
    ).rejects.toThrow('already exists')
  })

  test('returns added invitation', async () => {
    const registry = await { id: snippetIri }
    const invitation = await AgentRegistry.addSocialAgentInvitation(
      registry,
      deps,
      capabilityUrl,
      'Jane'
    )
    expect(invitation.capabilityUrl).toBe(capabilityUrl)
    expect(invitation.prefLabel).toBe('Jane')
  })
})

describe('addApplicationRegistration', () => {
  const gigaApp = 'https://gigaApp.example'

  test('throws if registration already exists', async () => {
    const applicationIri = 'https://projectron.example/#app'
    const registry = await { id: snippetIri }
    expect(
      AgentRegistry.addApplicationRegistration(
        registry,
        deps,
        { agent: webId, client: agentId },
        applicationIri
      )
    ).rejects.toThrow('already exists')
  })

  test('returns added registration', async () => {
    const registry = await { id: snippetIri }
    const registration = await AgentRegistry.addApplicationRegistration(
      registry,
      deps,
      { agent: webId, client: agentId },
      gigaApp
    )
    expect(registration.registeredAgent).toBe(gigaApp)
  })
})
