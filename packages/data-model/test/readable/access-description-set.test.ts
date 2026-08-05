import { randomUUID } from 'node:crypto'
import { fetch } from '@janeirodigital/interop-test-utils'
import { describe, test } from 'vitest'
import { AccessDescriptionSet, AuthorizationAgentFactory } from '../../src'
import { expect } from '../expect'

const webId = 'https://alice.example/#id'
const agentId = 'https://jarvis.alice.example/#agent'
const factory = new AuthorizationAgentFactory(webId, agentId, { fetch, randomUUID })
const snippetIri = 'https://projectron.example/descriptions-en'

test('factory should build an access description set', async () => {
  const descriptionSet = await factory.readable.accessDescriptionSet(snippetIri)
  expect(descriptionSet).toEqual({ id: snippetIri })
})

test('should build the descriptions', async () => {
  const descriptionSet = await factory.readable.accessDescriptionSet(snippetIri)
  const { accessNeedDescriptions, accessNeedGroupDescriptions } =
    await AccessDescriptionSet.loadDescriptions(descriptionSet, factory)
  expect(accessNeedDescriptions).toHaveLength(2)
  for (const description of accessNeedDescriptions) {
    expect(description.hasAccessNeed).toBeDefined()
  }
  expect(accessNeedGroupDescriptions).toHaveLength(1)
  for (const description of accessNeedGroupDescriptions) {
    expect(description.hasAccessNeedGroup).toBeDefined()
  }
})

describe('findInLanguage', () => {
  test('finds description set in language given a resource', async () => {
    const lang = 'en'
    const accessNeedIri = 'https://projectron.example/access-needs#need-project'
    const dataset = await (await factory.fetch(accessNeedIri)).dataset()
    const descriptionSetIri = AccessDescriptionSet.findInLanguage(dataset, lang)
    expect(descriptionSetIri).toBe('https://projectron.example/descriptions-en')
  })
})
