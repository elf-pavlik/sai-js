import { randomUUID } from 'node:crypto'
import { fetch } from '@janeirodigital/interop-test-utils'
import { describe, test } from 'vitest'
import { AuthorizationAgentFactory } from '../../src'
import { expect } from '../expect'

const webId = 'https://alice.example/#id'
const agentId = 'https://jarvis.alice.example/#agent'
const factory = new AuthorizationAgentFactory(webId, agentId, { fetch, randomUUID })
const snippetIri = 'https://pro.alice.example/773605f0-b5bf-4d46-878d-5c167eac8b5d'
const newSnippetIri = 'https://auth.alice.example/bd2bb0a3-e95a-4981-a30b-5b6a7358435c'

const data = {
  id: newSnippetIri,
  registeredShapeTree: 'https://solidshapes.example/tree/Other',
  contains: [],
}

describe('build', () => {
  test('should return data registration', async () => {
    const dataRegistration = await factory.crud.dataRegistration(snippetIri)
    expect(dataRegistration).toHaveProperty('id', snippetIri)
    expect(dataRegistration).toHaveProperty('registeredShapeTree')
  })

  test('should fetch its data if none passed', async () => {
    const dataRegistration = await factory.crud.dataRegistration(snippetIri)
    expect(dataRegistration.registeredShapeTree).toBe('https://solidshapes.example/trees/Project')
    expect(dataRegistration.contains).toHaveLength(2)
  })

  test('should set data if passed', async () => {
    const dataRegistration = await factory.crud.dataRegistration(newSnippetIri, data)
    expect(dataRegistration.id).toBe(newSnippetIri)
    expect(dataRegistration.registeredShapeTree).toBe(data.registeredShapeTree)
    expect(dataRegistration.contains).toEqual([])
  })
})
