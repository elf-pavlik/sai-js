import { randomUUID } from 'node:crypto'

import { fetch } from '@janeirodigital/interop-test-utils'
import { INTEROP, loader } from '@janeirodigital/interop-utils'
import { test } from 'vitest'

import { Grant } from '../../src'
const loadGrant = loader(Grant.fromJsonLd)

import { expect } from '../expect'

const deps = { fetch, randomUUID }
const selectedFromRegistryAccessGrantIri =
  'https://auth.alice.example/cd247a67-0879-4301-abd0-828f63abb252'
const inheritsFromSelectedFromRegistryIri =
  'https://auth.alice.example/9827ae00-2778-4655-9f22-08bb9daaee26'

test('should set correct scopeOfGrant', async () => {
  const accessGrant = await loadGrant(inheritsFromSelectedFromRegistryIri, deps.fetch)
  expect(accessGrant.scopeOfGrant).toBe(INTEROP.Inherited)
})

test('should set inheritsFromGrant', async () => {
  const accessGrant = await loadGrant(inheritsFromSelectedFromRegistryIri, deps.fetch)
  expect(accessGrant.inheritsFromGrant).toBe(selectedFromRegistryAccessGrantIri)
})

// depends on slash semantics
test('should provide dataRegistryIri', async () => {
  const accessGrant = await loadGrant(inheritsFromSelectedFromRegistryIri, deps.fetch)
  expect(Grant.dataRegistryIri(accessGrant)).toBe('https://pro.alice.example/')
})
