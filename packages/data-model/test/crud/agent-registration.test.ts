import { randomUUID } from 'node:crypto'
import { fetch } from '@janeirodigital/interop-test-utils'
import { INTEROP, RDF, SKOS } from '@janeirodigital/interop-utils'
import { DataFactory } from 'n3'
import { describe, test } from 'vitest'
import {
  addDataGrant,
  AuthorizationAgentFactory,
  CRUDSocialAgentRegistration,
  getDataGrantIris,
  type SocialAgentRegistrationData,
} from '../../src'
import { expect } from '../expect'

const webId = 'https://alice.example/#id'
const agentId = 'https://jarvis.alice.example/#agent'
const factory = new AuthorizationAgentFactory(webId, agentId, { fetch, randomUUID })
const snippetIri = 'https://auth.alice.example/bcf22534-0187-4ae4-b88f-fe0f9fa96659'
const newSnippetIri = 'https://auth.alice.example/afb6a337-40df-4fbe-9b00-5c9c1e56c812'
const dataGrantIri = 'https://auth.alice.example/cd247a67-0879-4301-abd0-828f63abb252'
const data = {
  registeredAgent: 'https://different.iri/',
  hasDataGrant: [dataGrantIri],
  prefLabel: 'Someone',
}

describe('build', () => {
  test('should return instance of Agent Registration', async () => {
    const agentRegistration = await CRUDSocialAgentRegistration.build(snippetIri, factory, false)
    expect(agentRegistration).toBeInstanceOf(CRUDSocialAgentRegistration)
  })

  test('should fetch its data if none passed', async () => {
    const agentRegistration = await CRUDSocialAgentRegistration.build(snippetIri, factory, false)
    expect(agentRegistration.dataset.size).toBe(19)
  })

  test('should set dataset if data passed', async () => {
    const quads = [
      DataFactory.quad(
        DataFactory.namedNode(newSnippetIri),
        RDF.type,
        INTEROP.SocialAgentRegistration
      ),
      DataFactory.quad(
        DataFactory.namedNode(newSnippetIri),
        INTEROP.registeredAgent,
        DataFactory.namedNode(data.registeredAgent)
      ),
      DataFactory.quad(
        DataFactory.namedNode(newSnippetIri),
        INTEROP.hasDataGrant,
        DataFactory.namedNode(dataGrantIri)
      ),
      DataFactory.quad(
        DataFactory.namedNode(newSnippetIri),
        SKOS.prefLabel,
        DataFactory.literal(data.prefLabel)
      ),
    ]
    const agentRegistration = await CRUDSocialAgentRegistration.build(
      newSnippetIri,
      factory,
      false,
      data
    )
    expect(agentRegistration.dataset.size).toBe(4)
    expect(agentRegistration.dataset).toBeRdfDatasetContaining(...quads)
  })

  test('should have updatedAt and registeredAt uset for new before update', async () => {
    const agentRegistration = await CRUDSocialAgentRegistration.build(
      newSnippetIri,
      factory,
      false,
      data
    )
    expect(agentRegistration.registeredAt).toBeUndefined()
    expect(agentRegistration.updatedAt).toBeUndefined()
  })
})

describe('getDataGrantIris', () => {
  test('should return data grant IRIs from dataset', async () => {
    const agentRegistration = await CRUDSocialAgentRegistration.build(snippetIri, factory, false)
    const iris = getDataGrantIris(agentRegistration)
    expect(iris).toContain(dataGrantIri)
  })
})

describe('registeredAgent', () => {
  test('should have getter', async () => {
    const agentRegistration = await CRUDSocialAgentRegistration.build(snippetIri, factory, false)
    expect(agentRegistration.registeredAgent).toBe('https://projectron.example/#app')
  })
})

describe('addDataGrant', () => {
  test('adds new data grant IRI to dataset', async () => {
    const agentRegistration = await CRUDSocialAgentRegistration.build(snippetIri, factory, false)
    const newGrantIri = 'https://auth.alice.example/812a837d-6774-448e-b4c0-f05763deda3d'
    const beforeIris = getDataGrantIris(agentRegistration)
    expect(beforeIris).not.toContain(newGrantIri)
    await addDataGrant(agentRegistration, newGrantIri)
    const afterIris = getDataGrantIris(agentRegistration)
    expect(afterIris).toContain(newGrantIri)
  })
})
