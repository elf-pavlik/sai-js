import { randomUUID } from 'node:crypto'
import { fetch } from '@janeirodigital/interop-test-utils'
import { describe, test } from 'vitest'
import { ApplicationFactory, ReadableApplicationRegistration } from '../../src'
import { expect } from '../expect'

const factory = new ApplicationFactory({ fetch, randomUUID })
const snippetIri = 'https://auth.alice.example/bcf22534-0187-4ae4-b88f-fe0f9fa96659'

describe('build', () => {
  test('should return instance of Application Registration', async () => {
    const applicationRegistration = await ReadableApplicationRegistration.build(snippetIri, factory)
    expect(applicationRegistration).toBeInstanceOf(ReadableApplicationRegistration)
  })

  test('should fetch its data', async () => {
    const applicationRegistration = await ReadableApplicationRegistration.build(snippetIri, factory)
    expect(applicationRegistration.dataset.size).toBeGreaterThan(0)
  })

  test('should provide data grants', async () => {
    const applicationRegistration = await ReadableApplicationRegistration.build(snippetIri, factory)
    const dataGrants = await applicationRegistration.getDataGrants()
    expect(dataGrants.length).toBeGreaterThan(0)
  })

  test('should provide iriForContained method', async () => {
    const applicationRegistration = await ReadableApplicationRegistration.build(snippetIri, factory)
    expect(applicationRegistration.iriForContained()).toMatch(applicationRegistration.iri)
  })
})
