import { randomUUID } from 'node:crypto'
import { fetch } from '@janeirodigital/interop-test-utils'
import { test } from 'vitest'
import { AuthorizationAgentFactory } from '../../src'
import { expect } from '../expect'

const factory = new AuthorizationAgentFactory({ fetch, randomUUID })
const snippetIri = 'https://projectron.example/descriptions-en#en-need-project'

test('getters', async () => {
  const description = await factory.accessNeedDescription(snippetIri)
  const expectedAccessNeedIri = 'https://projectron.example/access-needs#need-project'
  expect(description.hasAccessNeed).toBe(expectedAccessNeedIri)
  const expectedLabel =
    'Access to Projects is essential for Projectron to perform its core function of Project Management'
  expect(description.prefLabel).toBe(expectedLabel)
  expect(description.definition).toBe(undefined)
})
