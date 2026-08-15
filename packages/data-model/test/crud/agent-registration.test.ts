import { randomUUID } from 'node:crypto'
import { fetch } from '@janeirodigital/interop-test-utils'
import { INTEROP } from '@janeirodigital/interop-utils'
import { describe, test } from 'vitest'
import { AuthorizationAgentFactory, addDataGrant, getDataGrantIris, replaceDataGrants } from '../../src'
import { expect } from '../expect'

const factory = new AuthorizationAgentFactory({ fetch, randomUUID })
const snippetIri = 'https://auth.alice.example/bcf22534-0187-4ae4-b88f-fe0f9fa96659'
const newSnippetIri = 'https://auth.alice.example/afb6a337-40df-4fbe-9b00-5c9c1e56c812'
const dataGrantIri = 'https://auth.alice.example/cd247a67-0879-4301-abd0-828f63abb252'
const data = {
  registeredAgent: 'https://different.iri/',
  hasDataGrant: [dataGrantIri],
  prefLabel: 'Someone',
  type: [INTEROP.SocialAgentRegistration],
}

describe('build', () => {
  test('should return agent registration', async () => {
    const agentRegistration = await factory.socialAgentRegistration(snippetIri)
    expect(agentRegistration).toHaveProperty('id', snippetIri)
  })

  test('should fetch its data if none passed', async () => {
    const agentRegistration = await factory.socialAgentRegistration(snippetIri)
    expect(agentRegistration.registeredAgent).toBe('https://projectron.example/#app')
    expect(agentRegistration.hasDataGrant).toHaveLength(10)
  })

  test('should set data if passed', async () => {
    const agentRegistration = await factory.socialAgentRegistration(newSnippetIri, data)
    expect(agentRegistration).toMatchObject(data)
    expect(agentRegistration.id).toBe(newSnippetIri)
  })
})

describe('getDataGrantIris', () => {
  test('should return data grant IRIs from dataset', async () => {
    const agentRegistration = await factory.socialAgentRegistration(snippetIri)
    const iris = await getDataGrantIris(agentRegistration)
    expect(iris).toContain(dataGrantIri)
  })
})

describe('registeredAgent', () => {
  test('should have getter', async () => {
    const agentRegistration = await factory.socialAgentRegistration(snippetIri)
    expect(agentRegistration.registeredAgent).toBe('https://projectron.example/#app')
  })
})

describe('addDataGrant', () => {
  test('adds new data grant IRI to dataset', async () => {
    const agentRegistration = await factory.socialAgentRegistration(snippetIri)
    const newGrantIri = 'https://auth.alice.example/812a837d-6774-448e-b4c0-f05763deda3d'
    const beforeIris = await getDataGrantIris(agentRegistration)
    expect(beforeIris).not.toContain(newGrantIri)
    await addDataGrant(agentRegistration, factory, newGrantIri)
    expect(agentRegistration.hasDataGrant).toContain(newGrantIri)
  })
})

describe('replaceDataGrants', () => {
  test('replaces the whole data grant set', async () => {
    const agentRegistration = await factory.socialAgentRegistration(snippetIri)
    const newGrantIri = 'https://auth.alice.example/812a837d-6774-448e-b4c0-f05763deda3d'
    const beforeIris = await getDataGrantIris(agentRegistration)
    expect(beforeIris.length).toBeGreaterThan(0)
    await replaceDataGrants(agentRegistration, factory, [newGrantIri])
    expect(agentRegistration.hasDataGrant).toEqual([newGrantIri])
  })

  test('clears the whole data grant set with an empty list', async () => {
    const agentRegistration = await factory.socialAgentRegistration(snippetIri)
    await replaceDataGrants(agentRegistration, factory, [])
    expect(agentRegistration.hasDataGrant).toEqual([])
  })

  test('no-op when the set is unchanged', async () => {
    const agentRegistration = await factory.socialAgentRegistration(snippetIri)
    const beforeIris = await getDataGrantIris(agentRegistration)
    await replaceDataGrants(agentRegistration, factory, beforeIris)
    expect(agentRegistration.hasDataGrant).toEqual(beforeIris)
  })
})
