import { randomUUID } from 'node:crypto'
import { fetch } from '@janeirodigital/interop-test-utils'
import { test } from 'vitest'
import { ApplicationFactory, ShapeTree } from '../../src'
import type { ShapeTreeReference } from '../../src'
import { expect } from '../expect'

const factory = new ApplicationFactory({ fetch, randomUUID })
const snippetIri = 'https://solidshapes.example/trees/Project'
const taskTreeIri = 'https://solidshapes.example/trees/Task'

test('factory should build a shape tree', async () => {
  const shapeTree = await factory.readable.shapeTree(snippetIri)
  expect(shapeTree.id).toBe(snippetIri)
})

test.todo('provides describesInstance predicate')

test('provides references', async () => {
  const shapeTree = await factory.readable.shapeTree(snippetIri)
  expect(shapeTree.references).toStrictEqual(
    expect.arrayContaining([
      {
        shapeTree: taskTreeIri,
        viaPredicate: expect.objectContaining({
          value: 'https://vocab.example/project-management/hasTask',
        }),
      } as ShapeTreeReference,
    ])
  )
})

test('should get description for language', async () => {
  const lang = 'en'
  const shapeTree = await factory.readable.shapeTree(snippetIri)
  const en = await ShapeTree.getDescription(shapeTree, lang, factory)
  expect(en).toBeDefined()
  expect(en?.prefLabel).toBe('Projects')
  const otherLang = 'pl'
  const pl = await ShapeTree.getDescription(shapeTree, otherLang, factory)
  expect(pl).toBeDefined()
  expect(pl?.prefLabel).toBe('Projekty')
})

test('should gracefully fail if no description set for language', async () => {
  const lang = 'fr'
  const shapeTree = await factory.readable.shapeTree(snippetIri)
  const description = await ShapeTree.getDescription(shapeTree, lang, factory)
  expect(description).toBeNull()
})

test('should gracefully fail if description set with missing description for language', async () => {
  const lang = 'de'
  const shapeTree = await factory.readable.shapeTree(snippetIri)
  const description = await ShapeTree.getDescription(shapeTree, lang, factory)
  expect(description).toBeNull()
})

test('should get description languages', async () => {
  const shapeTree = await factory.readable.shapeTree(snippetIri)
  expect([...shapeTree.descriptionLanguages].sort()).toStrictEqual(['de', 'en', 'pl'])
})
