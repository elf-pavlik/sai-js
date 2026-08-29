import { randomUUID } from 'node:crypto'
import { fetch } from '@janeirodigital/interop-test-utils'
import { ACL } from '@janeirodigital/interop-utils'
import { describe, test } from 'vitest'
import { AccessNeed, accessNeed } from '../../src'
import { expect } from '../expect'

const deps = { fetch, randomUUID }
const snippetIri = 'https://projectron.example/access-needs#need-project'
const childIri = 'https://projectron.example/access-needs#need-task'

test('factory should build an access need', async () => {
  const need = await accessNeed(snippetIri, deps.fetch)
  expect(need.id).toBe(snippetIri)
})

test('getters', async () => {
  const need = await accessNeed(snippetIri, deps.fetch)
  expect(need.registeredShapeTree).toBe('https://solidshapes.example/trees/Project')
  expect(need.inheritsFromNeed).toBeUndefined()
  expect(need.hasInheritingNeed).toEqual(expect.arrayContaining([childIri]))
  expect(need.accessMode).toEqual(
    expect.arrayContaining([ACL.Read, ACL.Create, ACL.Update, ACL.Delete])
  )
  expect(need.required).toBe(true)
})

test('children', async () => {
  const need = await accessNeed(snippetIri, deps.fetch)
  expect(need.children).toHaveLength(1)
  expect(need.children[0].id).toBe(childIri)
})

test('parent', async () => {
  const childNeed = await accessNeed(childIri, deps.fetch)
  expect(childNeed.inheritsFromNeed).toBe(snippetIri)
  expect(childNeed.hasInheritingNeed).toHaveLength(0)
})

describe('descriptions', () => {
  test('should get description for language', async () => {
    const lang = 'en'
    const need = await accessNeed(snippetIri, deps.fetch)
    const description = await AccessNeed.getDescription(need, lang, deps.fetch)
    expect(description).toBeDefined()
    expect(description?.prefLabel).toBe(
      'Access to Projects is essential for Projectron to perform its core function of Project Management'
    )
  })

  test('should gracefully fail if no description set for language', async () => {
    const lang = 'fr'
    const need = await accessNeed(snippetIri, deps.fetch)
    const description = await AccessNeed.getDescription(need, lang, deps.fetch)
    expect(description).toBeUndefined()
  })

  test('should gracefully fail if description set with missing description for language', async () => {
    const lang = 'de'
    const need = await accessNeed(snippetIri, deps.fetch)
    const description = await AccessNeed.getDescription(need, lang, deps.fetch)
    expect(description).toBeUndefined()
  })

  test('should get description languages', async () => {
    const need = await accessNeed(snippetIri, deps.fetch)
    expect([...need.descriptionLanguages].sort()).toStrictEqual(['en', 'pl'])
  })

  test('should get reliable description languages', async () => {
    const need = await accessNeed(snippetIri, deps.fetch)
    const languages = await AccessNeed.reliableDescriptionLanguages(need, deps.fetch)
    expect([...languages].sort()).toStrictEqual(['en', 'pl'])
  })
})
