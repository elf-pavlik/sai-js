import { randomUUID } from 'node:crypto'
import { fetch } from '@janeirodigital/interop-test-utils'
import { test } from 'vitest'
import { loadShapeTreeDescription } from '../../src'
import { expect } from '../expect'

const deps = { fetch, randomUUID }
const snippetIri = 'https://solidshapes.example/trees/desc-en#Project'

test('getters', async () => {
  const description = await loadShapeTreeDescription(snippetIri, deps.fetch)
  expect(description.label).toBe('Projects')
  expect(description.definition).toBe('Creative processes with specific goals')
})
