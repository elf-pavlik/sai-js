import { randomUUID } from 'node:crypto'
import { fetch } from '@janeirodigital/interop-test-utils'
import { describe, test } from 'vitest'
import { ApplicationFactory } from '../../src'
import { expect } from '../expect'

const factory = new ApplicationFactory({ fetch, randomUUID })
const snippetIri = 'https://pro.alice.example/773605f0-b5bf-4d46-878d-5c167eac8b5d'

describe('getters', () => {
  test('id', async () => {
    const dataRegistration = await factory.readable.dataRegistration(snippetIri)
    expect(dataRegistration.id).toEqual(snippetIri)
  })

  test('registeredShapeTree', async () => {
    const dataRegistration = await factory.readable.dataRegistration(snippetIri)
    const shapeTreeIri = 'https://solidshapes.example/trees/Project'
    expect(dataRegistration.registeredShapeTree).toEqual(shapeTreeIri)
  })

  test('contains', async () => {
    const dataRegistration = await factory.readable.dataRegistration(snippetIri)
    expect(dataRegistration.contains.length).toBe(2)
    for (const contained of dataRegistration.contains) {
      expect(typeof contained).toBe('string')
    }
  })
})
