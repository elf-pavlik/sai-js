import { randomUUID } from 'node:crypto'
import { fetch } from '@janeirodigital/interop-test-utils'
import { ACL } from '@janeirodigital/interop-utils'
import { describe, test } from 'vitest'
import { AccessNeed, AuthorizationAgentFactory } from '../../src'
import { expect } from '../expect'

const factory = new AuthorizationAgentFactory({ fetch, randomUUID })
const snippetIri = 'https://projectron.example/access-needs#need-project'
const childIri = 'https://projectron.example/access-needs#need-task'

test('factory should build an access need', async () => {
  const need = await factory.accessNeed(snippetIri)
  expect(need.id).toBe(snippetIri)
})

test('getters', async () => {
  const need = await factory.accessNeed(snippetIri)
  expect(need.registeredShapeTree).toBe('https://solidshapes.example/trees/Project')
  expect(need.inheritsFromNeed).toBeUndefined()
  expect(need.hasInheritingNeed).toEqual(expect.arrayContaining([childIri]))
  expect(need.accessMode).toEqual(
    expect.arrayContaining([ACL.Read, ACL.Create, ACL.Update, ACL.Delete])
  )
  expect(need.required).toBe(true)
})

test('children', async () => {
  const need = await factory.accessNeed(snippetIri)
  expect(need.children).toHaveLength(1)
  expect(need.children[0].id).toBe(childIri)
})

test('parent', async () => {
  const childNeed = await factory.accessNeed(childIri)
  expect(childNeed.inheritsFromNeed).toBe(snippetIri)
  expect(childNeed.hasInheritingNeed).toHaveLength(0)
})

describe('descriptions', () => {
  test('should get description for language', async () => {
    const lang = 'en'
    const need = await factory.accessNeed(snippetIri)
    const description = await AccessNeed.getDescription(need, lang, factory)
    expect(description).toBeDefined()
    expect(description?.prefLabel).toBe(
      'Access to Projects is essential for Projectron to perform its core function of Project Management'
    )
  })

  test('should gracefully fail if no description set for language', async () => {
    const lang = 'fr'
    const need = await factory.accessNeed(snippetIri)
    const description = await AccessNeed.getDescription(need, lang, factory)
    expect(description).toBeUndefined()
  })

  test('should gracefully fail if description set with missing description for language', async () => {
    const lang = 'de'
    const need = await factory.accessNeed(snippetIri)
    const description = await AccessNeed.getDescription(need, lang, factory)
    expect(description).toBeUndefined()
  })

  test('should get description languages', async () => {
    const accessNeed = await factory.accessNeed(snippetIri)
    expect([...accessNeed.descriptionLanguages].sort()).toStrictEqual(['en', 'pl'])
  })

  test('should get reliable description languages', async () => {
    const accessNeed = await factory.accessNeed(snippetIri)
    const languages = await AccessNeed.reliableDescriptionLanguages(accessNeed, factory)
    expect([...languages].sort()).toStrictEqual(['en', 'pl'])
  })
})
