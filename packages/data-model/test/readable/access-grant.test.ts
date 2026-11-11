import { randomUUID } from 'node:crypto'

import { fetch } from '@janeirodigital/interop-test-utils'
import { ACCESS_ACTIONS, loader } from '@janeirodigital/interop-utils'
import { test } from 'vitest'

import { Grant } from '../../src'
const loadGrant = loader(Grant.fromJsonLd)

import { expect } from '../expect'

const deps = { fetch, randomUUID }
const accessGrantIri = 'https://auth.alice.example/cd247a67-0879-4301-abd0-828f63abb252'

test('should set the iri', async () => {
  const accessGrant = await loadGrant(accessGrantIri, deps.fetch)
  expect(accessGrant.id).toBe(accessGrantIri)
})

test('should set the type', async () => {
  const accessGrant = await loadGrant(accessGrantIri, deps.fetch)
  expect(accessGrant.type).toContain('https://www.w3.org/ns/lws#AccessGrant')
})

test('should set the access actions', async () => {
  const accessGrant = await loadGrant(accessGrantIri, deps.fetch)
  expect(accessGrant.access[0].action).toEqual([
    ACCESS_ACTIONS.read,
    ACCESS_ACTIONS.modify,
    ACCESS_ACTIONS.create,
    ACCESS_ACTIONS.delete,
  ])
})

test('should set the hasDataRegistration', async () => {
  const accessGrant = await loadGrant(accessGrantIri, deps.fetch)
  const dataRegistrationIri = 'https://pro.alice.example/773605f0-b5bf-4d46-878d-5c167eac8b5d'
  expect(accessGrant.hasDataRegistration).toBe(dataRegistrationIri)
})

test('should set registeredShapeTree', async () => {
  const accessGrant = await loadGrant(accessGrantIri, deps.fetch)
  const projectShapeTree = 'https://solidshapes.example/trees/Project'
  expect(accessGrant.registeredShapeTree).toBe(projectShapeTree)
})
