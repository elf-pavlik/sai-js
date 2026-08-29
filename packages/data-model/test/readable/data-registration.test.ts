import { randomUUID } from 'node:crypto'
import { fetch } from '@janeirodigital/interop-test-utils'
import { describe, test } from 'vitest'
import { loadDataRegistration } from '../../src'
import { expect } from '../expect'

const deps = { fetch, randomUUID }
const snippetIri = 'https://pro.alice.example/773605f0-b5bf-4d46-878d-5c167eac8b5d'

describe('getters', () => {
  test('id', async () => {
    const dataRegistration = await loadDataRegistration(snippetIri, deps.fetch)
    expect(dataRegistration.id).toEqual(snippetIri)
  })

  test('registeredShapeTree', async () => {
    const dataRegistration = await loadDataRegistration(snippetIri, deps.fetch)
    const shapeTreeIri = 'https://solidshapes.example/trees/Project'
    expect(dataRegistration.registeredShapeTree).toEqual(shapeTreeIri)
  })

  test('contains', async () => {
    const dataRegistration = await loadDataRegistration(snippetIri, deps.fetch)
    expect(dataRegistration.contains.length).toBe(2)
    for (const contained of dataRegistration.contains) {
      expect(typeof contained).toBe('string')
    }
  })
})
