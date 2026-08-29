import { randomUUID } from 'node:crypto'
import { fetch } from '@janeirodigital/interop-test-utils'
import { INTEROP } from '@janeirodigital/interop-utils'
import { describe, test } from 'vitest'
import { Grant, loadGrant } from '../../src'
import { expect } from '../expect'

const deps = { fetch, randomUUID }
const selectedFromRegistryDataGrantIri =
  'https://auth.alice.example/cd247a67-0879-4301-abd0-828f63abb252'
const inheritsFromSelectedFromRegistryIri =
  'https://auth.alice.example/9827ae00-2778-4655-9f22-08bb9daaee26'
const inheritsFromAllFromRegistryIri =
  'https://auth.alice.example/54b1a123-23ca-4733-9371-700b52b9c567'

test('should set correct scopeOfGrant', async () => {
  const dataGrant = await loadGrant(inheritsFromSelectedFromRegistryIri, deps.fetch)
  expect(dataGrant.scopeOfGrant).toBe(INTEROP.Inherited)
})

test('should set inheritsFromGrant', async () => {
  const dataGrant = await loadGrant(inheritsFromSelectedFromRegistryIri, deps.fetch)
  expect(dataGrant.inheritsFromGrant).toBe(selectedFromRegistryDataGrantIri)
})

// depends on slash semantics
test('should provide dataRegistryIri', async () => {
  const dataGrant = await loadGrant(inheritsFromSelectedFromRegistryIri, deps.fetch)
  expect(Grant.dataRegistryIri(dataGrant)).toBe('https://')
})

test('should provide data instance iterator for Inherited of AllFromRegistry', async () => {
  const inheritingGrant = await loadGrant(inheritsFromAllFromRegistryIri, deps.fetch)
  let count = 0
  for await (const instanceIri of Grant.getDataInstanceIterator(inheritingGrant, deps.fetch)) {
    expect(typeof instanceIri).toBe('string')
    count += 1
  }
  expect(count).toBe(2)
})

test('should provide data instance iterator for Inherited of SelectedFromRegistry', async () => {
  const inheritingGrant = await loadGrant(inheritsFromSelectedFromRegistryIri, deps.fetch)
  let count = 0
  for await (const instanceIri of Grant.getDataInstanceIterator(inheritingGrant, deps.fetch)) {
    expect(typeof instanceIri).toBe('string')
    count += 1
  }
  expect(count).toBe(1)
})
