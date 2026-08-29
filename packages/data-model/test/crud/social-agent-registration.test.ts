import { randomUUID } from 'node:crypto'
import { fetch, statelessFetch } from '@janeirodigital/interop-test-utils'
import { describe, test, vi } from 'vitest'
import {
  getAdminGrantIris,
  getDataGrantIris,
  loadSocialAgentRegistration,
  replaceAdminGrantLinks,
  setAccessNeedGroup,
} from '../../src'
import { expect } from '../expect'

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
