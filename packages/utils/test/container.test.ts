import { randomUUID } from 'node:crypto'
import { describe, expect, test } from 'vitest'
import { iriForContained } from '../src'

const iri = 'https://work.alice.example/something/'

describe('iriForContained', () => {
  test('generates a contained IRI from the container id', () => {
    const contained = iriForContained({ id: iri }, randomUUID)
    expect(contained).toMatch(iri)
    expect(contained.slice(iri.length)).not.toMatch(/\//)
  })

  test('appends a trailing slash when creating a container', () => {
    expect(iriForContained({ id: iri }, randomUUID, true).endsWith('/')).toBe(true)
  })
})
