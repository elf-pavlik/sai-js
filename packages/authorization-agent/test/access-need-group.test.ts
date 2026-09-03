import { randomUUID } from 'node:crypto'
import { AccessNeedGroup, accessNeedGroup } from '@janeirodigital/interop-authorization-agent'
import { fetch } from '@janeirodigital/interop-test-utils'
import { describe, test } from 'vitest'
import { expect } from './expect'

const deps = { fetch, randomUUID }
const snippetIri = 'https://projectron.example/access-needs#need-group-pm'

test('factory should build an access need group', async () => {
  const needGroup = await accessNeedGroup(snippetIri, deps.fetch)
  expect(needGroup.id).toBe(snippetIri)
})

test('access needs', async () => {
  const needGroup = await accessNeedGroup(snippetIri, deps.fetch)
  const accessNeedIri = 'https://projectron.example/access-needs#need-project'
  expect(needGroup.hasAccessNeed).toEqual([accessNeedIri])
  expect(needGroup.accessNeeds).toHaveLength(1)
  expect(needGroup.accessNeeds[0].id).toBe(accessNeedIri)
})

describe('descriptions', () => {
  test('should get description for language', async () => {
    const lang = 'en'
    const needGroup = await accessNeedGroup(snippetIri, deps.fetch)
    const description = await AccessNeedGroup.getDescription(needGroup, lang, deps.fetch)
    expect(description).toBeDefined()
    expect(description?.label).toBe('Manage Projects')
    expect(description?.definition).toBe(
      'Allow Projectron to read the Projects you select, and Task in those projects.'
    )
  })

  test('should gracefully fail if no description set for language', async () => {
    const lang = 'fr'
    const needGroup = await accessNeedGroup(snippetIri, deps.fetch)
    const description = await AccessNeedGroup.getDescription(needGroup, lang, deps.fetch)
    expect(description).toBeUndefined()
  })

  test('should gracefully fail if description set with missing description for language', async () => {
    const lang = 'de'
    const needGroup = await accessNeedGroup(snippetIri, deps.fetch)
    const description = await AccessNeedGroup.getDescription(needGroup, lang, deps.fetch)
    expect(description).toBeUndefined()
  })

  test('should get reliable description languages', async () => {
    const needGroup = await accessNeedGroup(snippetIri, deps.fetch)
    const languages = await AccessNeedGroup.reliableDescriptionLanguages(needGroup, deps.fetch)
    expect([...languages].sort()).toStrictEqual(['en', 'pl'])
  })
})
