import { randomUUID } from 'node:crypto'
import { fetch } from '@janeirodigital/interop-test-utils'
import { test } from 'vitest'
import { loadAccessNeedGroupDescription } from '../../src'
import { expect } from '../expect'

const deps = { fetch, randomUUID }
const snippetIri = 'https://projectron.example/descriptions-en#en-need-group-pm'

test('getters', async () => {
  const description = await loadAccessNeedGroupDescription(snippetIri, deps.fetch)
  const expectedAccessNeedGroupIri = 'https://projectron.example/access-needs#need-group-pm'
  expect(description.hasAccessNeedGroup).toBe(expectedAccessNeedGroupIri)
  const expectedLabel = 'Manage Projects'
  expect(description.prefLabel).toBe(expectedLabel)
  const expectedDefinition =
    'Allow Projectron to read the Projects you select, and Task in those projects.'
  expect(description.definition).toBe(expectedDefinition)
})
