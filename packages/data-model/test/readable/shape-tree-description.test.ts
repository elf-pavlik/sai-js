import { randomUUID } from 'node:crypto'
import { fetch } from '@janeirodigital/interop-test-utils'
import { loader } from '@janeirodigital/interop-utils'
import { test } from 'vitest'
import { ShapeTreeDescription } from '../../src'
const loadShapeTreeDescription = loader(ShapeTreeDescription.fromJsonLd)
import { expect } from '../expect'

const deps = { fetch, randomUUID }
const snippetIri = 'https://solidshapes.example/trees/desc-en#Project'

test('getters', async () => {
  const description = await loadShapeTreeDescription(snippetIri, deps.fetch)
  expect(description.label).toEqual({ en: 'Projects' })
  expect(description.definition).toEqual({ '@none': 'Creative processes with specific goals' })
})
