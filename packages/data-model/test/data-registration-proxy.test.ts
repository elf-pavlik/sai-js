import { randomUUID } from 'node:crypto'
import { fetch } from '@janeirodigital/interop-test-utils'
import { describe, test, vi } from 'vitest'
import {
  ApplicationFactory,
  DataInstance,
  Grant,
  ReadableDataRegistrationProxy,
} from '../src'
import { expect } from './expect'

const factory = new ApplicationFactory({ fetch, randomUUID })

const grantIri = 'https://auth.alice.example/7b2bc4ff-b4b8-47b8-96f6-06695f4c5126'

describe('getters', () => {
  test('iri', async () => {
    const grant = await factory.readable.dataGrant(grantIri)
    const dataRegistrationProxy = new ReadableDataRegistrationProxy(grant, factory)
    expect(dataRegistrationProxy.iri).toBe(
      'https://home.alice.example/f6ccd3a4-45ea-4f98-8a36-98eac92a6720'
    )
  })

  test('grant', async () => {
    const grant = await factory.readable.dataGrant(grantIri)
    const dataRegistrationProxy = new ReadableDataRegistrationProxy(grant, factory)
    expect(dataRegistrationProxy.grant).toBe(grant)
  })
})

test('should delegate dataInstances to grant', async () => {
  const grant = await factory.readable.dataGrant(grantIri)
  const spy = vi.spyOn(Grant, 'getDataInstanceIterator')
  const dataRegistrationProxy = new ReadableDataRegistrationProxy(grant, factory)
  for await (const dataInstance of dataRegistrationProxy.dataInstances) {
    expect(dataInstance).toBeInstanceOf(DataInstance)
  }
  expect(spy).toHaveBeenCalledTimes(1)
})

test('should delegate newDataInstance to grant', async () => {
  const grant = await factory.readable.dataGrant(grantIri)
  const dataRegistrationProxy = new ReadableDataRegistrationProxy(grant, factory)
  const spy = vi.spyOn(Grant, 'newDataInstance')
  await dataRegistrationProxy.newDataInstance()
  expect(spy).toHaveBeenCalledTimes(1)
})

test('should throw error if SelectedFromRegistry grant', async () => {
  const selectedFromRegistryGrantIri =
    'https://auth.alice.example/cd247a67-0879-4301-abd0-828f63abb252'
  const grant = await factory.readable.dataGrant(selectedFromRegistryGrantIri)
  const dataRegistrationProxy = new ReadableDataRegistrationProxy(grant, factory)
  await expect(dataRegistrationProxy.newDataInstance()).rejects.toThrow(
    'cannot create instances based on SelectedFromRegistry data grant'
  )
})

test('should throw error if InheritedInstances grant and no parent', async () => {
  const inheritedGrantIri =
    'https://auth.alice.example/9827ae00-2778-4655-9f22-08bb9daaee26'
  const grant = await factory.readable.dataGrant(inheritedGrantIri)
  const dataRegistrationProxy = new ReadableDataRegistrationProxy(grant, factory)
  await expect(dataRegistrationProxy.newDataInstance()).rejects.toThrow(
    'cannot create instances based on Inherited data grant'
  )
})
