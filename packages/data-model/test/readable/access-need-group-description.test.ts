import { randomUUID } from 'node:crypto'
import { fetch } from '@janeirodigital/interop-test-utils'
import { test } from 'vitest'
import { AuthorizationAgentFactory } from '../../src'
import { expect } from '../expect'

const webId = 'https://alice.example/#id'
const agentId = 'https://jarvis.alice.example/#agent'
const factory = new AuthorizationAgentFactory(webId, agentId, { fetch, randomUUID })
const snippetIri = 'https://projectron.example/descriptions-en#en-need-group-pm'

test('getters', async () => {
  const description = await factory.readable.accessNeedGroupDescription(snippetIri)
  const expectedAccessNeedGroupIri = 'https://projectron.example/access-needs#need-group-pm'
  expect(description.hasAccessNeedGroup).toBe(expectedAccessNeedGroupIri)
  const expectedLabel = 'Manage Projects'
  expect(description.prefLabel).toBe(expectedLabel)
  const expectedDefinition =
    'Allow Projectron to read the Projects you select, and Task in those projects.'
  expect(description.definition).toBe(expectedDefinition)
})
