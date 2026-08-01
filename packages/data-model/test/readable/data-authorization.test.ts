import { randomUUID } from 'node:crypto'
import { fetch } from '@janeirodigital/interop-test-utils'
import { ACL, INTEROP } from '@janeirodigital/interop-utils'
import { describe, test } from 'vitest'
import {
  AuthorizationAgentFactory,
  DataAuthorization,
  type FinalDataAuthorizationData,
} from '../../src'
import { expect } from '../expect'

const webId = 'https://alice.example/#id'
const agentId = 'https://jarvis.alice.example/#agent'
const factory = new AuthorizationAgentFactory(webId, agentId, { fetch, randomUUID })

describe('getters', () => {
  test('should provide hasDataInstance', async () => {
    const selectedDataAuthorizationIri =
      'https://auth.alice.example/bee6bc10-2eb9-4b2d-b0c4-84c5d9039e53'
    const dataAuthorization = await factory.readable.dataAuthorization(selectedDataAuthorizationIri)
    expect(dataAuthorization.id).toBe(selectedDataAuthorizationIri)
    expect(dataAuthorization.hasDataInstance).toHaveLength(2)
  })

  test('should provide grantee', async () => {
    const dataAuthorizationIri = 'https://auth.alice.example/e2765d6c-848a-4fc0-9092-556903730263'
    const dataAuthorization = await factory.readable.dataAuthorization(dataAuthorizationIri)
    expect(dataAuthorization.grantee).toBe('https://projectron.example/#app')
  })

  test('should provide grantedBy', async () => {
    const dataAuthorizationIri = 'https://auth.alice.example/e2765d6c-848a-4fc0-9092-556903730263'
    const dataAuthorization = await factory.readable.dataAuthorization(dataAuthorizationIri)
    expect(dataAuthorization.grantedBy).toBe(webId)
  })

  test('should provide dataOwner', async () => {
    const dataAuthorizationIri = 'https://auth.alice.example/e2765d6c-848a-4fc0-9092-556903730263'
    const dataAuthorization = await factory.readable.dataAuthorization(dataAuthorizationIri)
    expect(dataAuthorization.dataOwner).toBe('https://acme.example/#corp')
  })

  test('should provide scopeOfAuthorization', async () => {
    const dataAuthorizationIri = 'https://auth.alice.example/e2765d6c-848a-4fc0-9092-556903730263'
    const dataAuthorization = await factory.readable.dataAuthorization(dataAuthorizationIri)
    expect(dataAuthorization.scopeOfAuthorization).toBe(INTEROP.AllFromAgent.value)
  })

  test('should provide hasInheritingAuthorization', async () => {
    const dataAuthorizationIri = 'https://auth.alice.example/e2765d6c-848a-4fc0-9092-556903730263'
    const dataAuthorization = await factory.readable.dataAuthorization(dataAuthorizationIri)
    expect(dataAuthorization.hasInheritingAuthorization).toEqual([
      'https://auth.alice.example/6a9feb57-252b-43b2-8470-5a938888b2fa',
    ])
  })

  test('should provide accessMode', async () => {
    const dataAuthorizationIri = 'https://auth.alice.example/e2765d6c-848a-4fc0-9092-556903730263'
    const dataAuthorization = await factory.readable.dataAuthorization(dataAuthorizationIri)
    expect(dataAuthorization.accessMode).toEqual([ACL.Read.value, ACL.Write.value])
  })
})

describe('round-trip', () => {
  const allFromRegistryData: FinalDataAuthorizationData = {
    id: 'https://some.iri/da',
    grantee: 'https://projectron.example/#app',
    grantedBy: webId,
    registeredShapeTree: 'https://solidshapes.example/trees/Project',
    scopeOfAuthorization: INTEROP.AllFromRegistry.value,
    dataOwner: 'https://alice.example/#id',
    hasDataRegistration: 'https://pro.alice.example/123',
    accessMode: [ACL.Read.value, ACL.Write.value],
  }

  test('toDataset + fromDataset', async () => {
    const dataset = await DataAuthorization.toDataset(allFromRegistryData)
    const result = await DataAuthorization.fromDataset(dataset, allFromRegistryData.id)
    expect(result).toMatchObject(allFromRegistryData)
  })

  test('toDataset + fromDataset with hasDataInstance', async () => {
    const data: FinalDataAuthorizationData = {
      ...allFromRegistryData,
      scopeOfAuthorization: INTEROP.SelectedFromRegistry.value,
      hasDataInstance: ['https://some.iri/a', 'https://some.iri/b'],
    }
    const dataset = await DataAuthorization.toDataset(data)
    const result = await DataAuthorization.fromDataset(dataset, data.id)
    expect(result).toMatchObject(data)
  })

  test('toDataset + fromDataset links back to children', async () => {
    const childIri = 'https://some.iri/child'
    const data: FinalDataAuthorizationData = {
      ...allFromRegistryData,
      hasInheritingAuthorization: [childIri],
    }
    const dataset = await DataAuthorization.toDataset(data)
    const result = await DataAuthorization.fromDataset(dataset, data.id)
    expect(result.hasInheritingAuthorization).toEqual([childIri])
  })

  test('toJsonLd + fromJsonLd', async () => {
    const doc = DataAuthorization.toJsonLd(allFromRegistryData)
    const result = await DataAuthorization.fromJsonLd(doc, allFromRegistryData.id)
    expect(result).toMatchObject(allFromRegistryData)
  })
})
