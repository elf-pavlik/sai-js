import { randomUUID } from 'node:crypto'
import { fetch, statelessFetch } from '@janeirodigital/interop-test-utils'
import {
  discoverAgentRegistration,
  discoverAuthorizationAgent,
} from '@janeirodigital/interop-utils'
import { beforeEach, describe, test, vi } from 'vitest'
import {
  AuthorizationAgentFactory,
  discoverAndUpdateReciprocal,
  discoverReciprocal,
  getDataGrantIris,
  setAccessNeedGroup,
} from '../../src'
import { expect } from '../expect'

// wrap discovery helpers so tests can control the outcome of
// discoverReciprocal without replacing the whole module
vi.mock('@janeirodigital/interop-utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@janeirodigital/interop-utils')>()
  return {
    ...actual,
    discoverAuthorizationAgent: vi.fn(actual.discoverAuthorizationAgent),
    discoverAgentRegistration: vi.fn(actual.discoverAgentRegistration),
  }
})

const webId = 'https://alice.example/#id'
const agentId = 'https://jarvis.alice.example/#agent'

describe('build', () => {
  const factory = new AuthorizationAgentFactory(webId, agentId, { fetch, randomUUID })
  const snippetIri = 'https://auth.alice.example/5dc3c14e-7830-475f-b8e3-4748d6c0bccb'

  test('should return social agent registration, with reciprocal', async () => {
    const socialAgentRegistration = await factory.crud.socialAgentRegistration(snippetIri)
    expect(socialAgentRegistration).toHaveProperty('id', snippetIri)
    expect(socialAgentRegistration.reciprocalRegistration).toBe(
      'https://auth.acme.example/2437895a-3a68-4048-8965-889b7e93936c'
    )
  })

  test('should return social agent registration, without reciprocal based on data', async () => {
    const withoutReciprocalIri = 'https://auth.alice.example/76849244-0e74-4d8a-8d07-48eae753faa9'
    const socialAgentRegistration = await factory.crud.socialAgentRegistration(withoutReciprocalIri)
    expect(socialAgentRegistration).toHaveProperty('id', withoutReciprocalIri)
    expect(socialAgentRegistration.reciprocalRegistration).toBeUndefined()
  })

  test('should have expected fields', async () => {
    const socialAgentRegistration = await factory.crud.socialAgentRegistration(snippetIri)
    expect(socialAgentRegistration.registeredAgent).toBe('https://acme.example/#corp')
    expect(socialAgentRegistration.prefLabel).toBe('ACME')
    expect(socialAgentRegistration.note).toBe('A company making well known gadgets')
  })

  test('should build reciprocal registration', async () => {
    const socialAgentRegistration = await factory.crud.socialAgentRegistration(snippetIri)
    expect(socialAgentRegistration.reciprocalRegistration).toBe(
      'https://auth.acme.example/2437895a-3a68-4048-8965-889b7e93936c'
    )
  })
  test('should have data grant IRIs', async () => {
    const acme2bobRegistrationIri = 'https://auth.acme.example/2437895a-3a68-4048-8965-889b7e93936c'
    const socialAgentRegistration =
      await factory.crud.socialAgentRegistration(acme2bobRegistrationIri)
    const iris = await getDataGrantIris(socialAgentRegistration)
    expect(iris.length).toBeGreaterThan(0)
  })
})

describe('reciprocal registration discovery', () => {
  const snippetIri = 'https://auth.acme.example/2437895a-3a68-4048-8965-889b7e93936c'
  const agentRegistrationIri = 'https://auth.alice.example/bcf22534-0187-4ae4-b88f-fe0f9fa96659'
  const factory = new AuthorizationAgentFactory(webId, agentId, { fetch, randomUUID })

  describe('discoverReciprocal', () => {
    test('should discover registration', async () => {
      const linkString = `
        <https://projectron.example/#app>;
        anchor="${agentRegistrationIri}";
        rel="http://www.w3.org/ns/solid/interop#registeredAgent"
      `
      const mocked = vi.fn(statelessFetch)
      const responseMock = {
        ok: true,
        headers: { get: (name: string): string | null => (name === 'Link' ? linkString : null) },
      } as unknown as Response
      responseMock.clone = () => ({ ...responseMock })
      mocked.mockResolvedValueOnce(responseMock)

      const socialAgentRegistration = await factory.crud.socialAgentRegistration(snippetIri)

      const registrationIri = await discoverReciprocal(socialAgentRegistration, factory, mocked)
      expect(registrationIri).toBe(agentRegistrationIri)
    })

    test('should return null if no authorization agent found', async () => {
      const customSnippetIri = 'https://auth.alice.example/b1f69979-dd47-4709-b2ed-a7119f29b135'
      const socialAgentRegistration = await factory.crud.socialAgentRegistration(customSnippetIri)
      const registrationIri = await discoverReciprocal(
        socialAgentRegistration,
        factory,
        statelessFetch
      )
      expect(registrationIri).toBeNull()
    })
  })

  describe('discoverAndUpdateReciprocal', () => {
    beforeEach(() => {
      vi.mocked(discoverAuthorizationAgent).mockResolvedValue('https://auth.jean.example/')
    })

    test('should update reciprocal if discovered (with no prior)', async () => {
      vi.mocked(discoverAgentRegistration).mockResolvedValue(agentRegistrationIri)
      const withoutReciprocalIri = 'https://auth.alice.example/76849244-0e74-4d8a-8d07-48eae753faa9'
      const socialAgentRegistration =
        await factory.crud.socialAgentRegistration(withoutReciprocalIri)
      expect(socialAgentRegistration.reciprocalRegistration).toBeUndefined()
      await discoverAndUpdateReciprocal(socialAgentRegistration, factory, statelessFetch)
      expect(socialAgentRegistration.reciprocalRegistration).toBe(agentRegistrationIri)
    })

    test('should update reciprocal if discovered (with prior)', async () => {
      vi.mocked(discoverAgentRegistration).mockResolvedValue(agentRegistrationIri)
      const customSnippetIri = 'https://auth.alice.example/5dc3c14e-7830-475f-b8e3-4748d6c0bccb'
      const priorAgentRegistrationIri =
        'https://auth.acme.example/2437895a-3a68-4048-8965-889b7e93936c'
      const socialAgentRegistration = await factory.crud.socialAgentRegistration(customSnippetIri)
      expect(socialAgentRegistration.reciprocalRegistration).toBe(priorAgentRegistrationIri)
      await discoverAndUpdateReciprocal(socialAgentRegistration, factory, statelessFetch)
      expect(socialAgentRegistration.reciprocalRegistration).toBe(agentRegistrationIri)
    })

    test('should not update reciprocal if not discovered', async () => {
      vi.mocked(discoverAgentRegistration).mockResolvedValue(undefined)
      const socialAgentRegistration = await factory.crud.socialAgentRegistration(snippetIri)
      const priorReciprocal = socialAgentRegistration.reciprocalRegistration
      await discoverAndUpdateReciprocal(socialAgentRegistration, factory, statelessFetch)
      expect(socialAgentRegistration.reciprocalRegistration).toBe(priorReciprocal)
    })
  })
})

describe('setAccessNeedGroup', () => {
  const snippetIri = 'https://auth.acme.example/2437895a-3a68-4048-8965-889b7e93936c'
  const factory = new AuthorizationAgentFactory(webId, agentId, { fetch, randomUUID })

  test('updates dataset also if one previousy existed', async () => {
    const socialAgentRegistration = await factory.crud.socialAgentRegistration(snippetIri)
    const newAccessNeedGroupIri = 'https://auth.alice.example/some-access-need-group'
    expect(socialAgentRegistration.hasAccessNeedGroup).toBeUndefined()
    await setAccessNeedGroup(socialAgentRegistration, factory, newAccessNeedGroupIri)
    expect(socialAgentRegistration.hasAccessNeedGroup).toBe(newAccessNeedGroupIri)

    const anotherAccessNeedGroupIri = 'https://auth.alice.example/another-access-need-group'
    await setAccessNeedGroup(socialAgentRegistration, factory, anotherAccessNeedGroupIri)
    expect(socialAgentRegistration.hasAccessNeedGroup).toBe(anotherAccessNeedGroupIri)
  })
})
