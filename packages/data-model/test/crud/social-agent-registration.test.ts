import { randomUUID } from 'node:crypto'
import { fetch, statelessFetch } from '@janeirodigital/interop-test-utils'
import {
  discoverAgentRegistration,
  discoverAuthorizationAgent,
} from '@janeirodigital/interop-utils'
import { beforeEach, describe, test, vi } from 'vitest'
import {
  discoverAndUpdateReciprocal,
  discoverReciprocal,
  getAdminGrantIris,
  getDataGrantIris,
  loadSocialAgentRegistration,
  replaceAdminGrantLinks,
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

describe('build', () => {
  const deps = { fetch, randomUUID }
  const snippetIri = 'https://auth.alice.example/5dc3c14e-7830-475f-b8e3-4748d6c0bccb'

  test('should return social agent registration, with reciprocal', async () => {
    const socialAgentRegistration = await loadSocialAgentRegistration(snippetIri, deps.fetch)
    expect(socialAgentRegistration).toHaveProperty('id', snippetIri)
    expect(socialAgentRegistration.reciprocalRegistration).toBe(
      'https://auth.acme.example/2437895a-3a68-4048-8965-889b7e93936c'
    )
  })

  test('should return social agent registration, without reciprocal based on data', async () => {
    const withoutReciprocalIri = 'https://auth.alice.example/76849244-0e74-4d8a-8d07-48eae753faa9'
    const socialAgentRegistration = await loadSocialAgentRegistration(
      withoutReciprocalIri,
      deps.fetch
    )
    expect(socialAgentRegistration).toHaveProperty('id', withoutReciprocalIri)
    expect(socialAgentRegistration.reciprocalRegistration).toBeUndefined()
  })

  test('should have expected fields', async () => {
    const socialAgentRegistration = await loadSocialAgentRegistration(snippetIri, deps.fetch)
    expect(socialAgentRegistration.registeredAgent).toBe('https://acme.example/#corp')
    expect(socialAgentRegistration.prefLabel).toBe('ACME')
    expect(socialAgentRegistration.note).toBe('A company making well known gadgets')
  })

  test('should build reciprocal registration', async () => {
    const socialAgentRegistration = await loadSocialAgentRegistration(snippetIri, deps.fetch)
    expect(socialAgentRegistration.reciprocalRegistration).toBe(
      'https://auth.acme.example/2437895a-3a68-4048-8965-889b7e93936c'
    )
  })
  test('should have data grant IRIs', async () => {
    const acme2bobRegistrationIri = 'https://auth.acme.example/2437895a-3a68-4048-8965-889b7e93936c'
    const socialAgentRegistration = await loadSocialAgentRegistration(
      acme2bobRegistrationIri,
      deps.fetch
    )
    const iris = await getDataGrantIris(socialAgentRegistration)
    expect(iris.length).toBeGreaterThan(0)
  })
})

describe('reciprocal registration discovery', () => {
  const snippetIri = 'https://auth.acme.example/2437895a-3a68-4048-8965-889b7e93936c'
  const agentRegistrationIri = 'https://auth.alice.example/bcf22534-0187-4ae4-b88f-fe0f9fa96659'
  const deps = { fetch, randomUUID }

  describe('discoverReciprocal', () => {
    test('should discover registration', async () => {
      const linkString = `
        <https://projectron.example/#app>;
        anchor="${agentRegistrationIri}";
        rel="http://www.w3.org/ns/solid/interop#registeredAgent"
      `
      vi.mocked(discoverAuthorizationAgent).mockResolvedValue('https://auth.alice.example/')
      const mocked = vi.fn(statelessFetch)
      const responseMock = {
        ok: true,
        headers: { get: (name: string): string | null => (name === 'Link' ? linkString : null) },
      } as unknown as Response
      responseMock.clone = () => ({ ...responseMock })
      mocked.mockResolvedValueOnce(responseMock)

      const socialAgentRegistration = await loadSocialAgentRegistration(snippetIri, deps.fetch)

      const registrationIri = await discoverReciprocal(socialAgentRegistration, mocked)
      expect(registrationIri).toBe(agentRegistrationIri)
    })

    test('should return null if no authorization agent found', async () => {
      vi.mocked(discoverAuthorizationAgent).mockResolvedValue(undefined)
      const customSnippetIri = 'https://auth.alice.example/b1f69979-dd47-4709-b2ed-a7119f29b135'
      const socialAgentRegistration = await loadSocialAgentRegistration(
        customSnippetIri,
        deps.fetch
      )
      const registrationIri = await discoverReciprocal(socialAgentRegistration, statelessFetch)
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
      const socialAgentRegistration = await loadSocialAgentRegistration(
        withoutReciprocalIri,
        deps.fetch
      )
      expect(socialAgentRegistration.reciprocalRegistration).toBeUndefined()
      await discoverAndUpdateReciprocal(socialAgentRegistration, statelessFetch)
      expect(socialAgentRegistration.reciprocalRegistration).toBe(agentRegistrationIri)
    })

    test('should update reciprocal if discovered (with prior)', async () => {
      vi.mocked(discoverAgentRegistration).mockResolvedValue(agentRegistrationIri)
      const customSnippetIri = 'https://auth.alice.example/5dc3c14e-7830-475f-b8e3-4748d6c0bccb'
      const priorAgentRegistrationIri =
        'https://auth.acme.example/2437895a-3a68-4048-8965-889b7e93936c'
      const socialAgentRegistration = await loadSocialAgentRegistration(
        customSnippetIri,
        deps.fetch
      )
      expect(socialAgentRegistration.reciprocalRegistration).toBe(priorAgentRegistrationIri)
      await discoverAndUpdateReciprocal(socialAgentRegistration, statelessFetch)
      expect(socialAgentRegistration.reciprocalRegistration).toBe(agentRegistrationIri)
    })

    test('should not update reciprocal if not discovered', async () => {
      vi.mocked(discoverAgentRegistration).mockResolvedValue(undefined)
      const socialAgentRegistration = await loadSocialAgentRegistration(snippetIri, deps.fetch)
      const priorReciprocal = socialAgentRegistration.reciprocalRegistration
      await discoverAndUpdateReciprocal(socialAgentRegistration, statelessFetch)
      expect(socialAgentRegistration.reciprocalRegistration).toBe(priorReciprocal)
    })
  })
})

describe('setAccessNeedGroup', () => {
  const snippetIri = 'https://auth.acme.example/2437895a-3a68-4048-8965-889b7e93936c'
  const deps = { fetch, randomUUID }

  test('updates dataset also if one previousy existed', async () => {
    const socialAgentRegistration = await loadSocialAgentRegistration(snippetIri, deps.fetch)
    const newAccessNeedGroupIri = 'https://auth.alice.example/some-access-need-group'
    expect(socialAgentRegistration.hasAccessNeedGroup).toBeUndefined()
    await setAccessNeedGroup(socialAgentRegistration, deps.fetch, newAccessNeedGroupIri)
    expect(socialAgentRegistration.hasAccessNeedGroup).toBe(newAccessNeedGroupIri)

    const anotherAccessNeedGroupIri = 'https://auth.alice.example/another-access-need-group'
    await setAccessNeedGroup(socialAgentRegistration, deps.fetch, anotherAccessNeedGroupIri)
    expect(socialAgentRegistration.hasAccessNeedGroup).toBe(anotherAccessNeedGroupIri)
  })
})

describe('admin grant links (R1)', () => {
  const snippetIri = 'https://auth.alice.example/registration-admin'
  const deps = { fetch, randomUUID }
  const grantOne = 'https://auth.alice.example/grant-admin-1'
  const grantTwo = 'https://auth.alice.example/grant-admin-2'

  test('frames hasAdminGrant from the registration resource', async () => {
    const socialAgentRegistration = await loadSocialAgentRegistration(snippetIri, deps.fetch)
    expect(await getAdminGrantIris(socialAgentRegistration)).toEqual([grantOne, grantTwo])
  })

  test('replaceAdminGrantLinks patches remove+insert in a single request', async () => {
    const socialAgentRegistration = await loadSocialAgentRegistration(snippetIri, deps.fetch)
    const mockedFetch = vi.fn(statelessFetch)
    const statefulDeps = { fetch: mockedFetch, randomUUID }
    const grantThree = 'https://auth.alice.example/grant-admin-3'

    await replaceAdminGrantLinks(socialAgentRegistration, statefulDeps.fetch, [
      grantOne,
      grantThree,
    ])

    expect(mockedFetch).toBeCalledWith(
      expect.any(String),
      expect.objectContaining({
        body: expect.stringContaining('DELETE DATA'),
      })
    )
    expect(mockedFetch).toBeCalledWith(
      expect.any(String),
      expect.objectContaining({
        body: expect.stringContaining('INSERT DATA'),
      })
    )
    expect(socialAgentRegistration.hasAdminGrant).toEqual([grantOne, grantThree])
  })

  test('replaceAdminGrantLinks unlinks with an empty list', async () => {
    const socialAgentRegistration = await loadSocialAgentRegistration(snippetIri, deps.fetch)
    const mockedFetch = vi.fn(statelessFetch)
    const statefulDeps = { fetch: mockedFetch, randomUUID }

    await replaceAdminGrantLinks(socialAgentRegistration, statefulDeps.fetch, [])

    expect(mockedFetch).toBeCalledWith(
      expect.any(String),
      expect.objectContaining({
        body: expect.stringContaining('DELETE DATA'),
      })
    )
    expect(socialAgentRegistration.hasAdminGrant).toEqual([])
  })

  test('replaceAdminGrantLinks is a no-op when the links already match', async () => {
    const socialAgentRegistration = await loadSocialAgentRegistration(snippetIri, deps.fetch)
    const mockedFetch = vi.fn(statelessFetch)
    const statefulDeps = { fetch: mockedFetch, randomUUID }

    await replaceAdminGrantLinks(socialAgentRegistration, statefulDeps.fetch, [grantOne, grantTwo])

    expect(mockedFetch).not.toHaveBeenCalled()
  })
})
