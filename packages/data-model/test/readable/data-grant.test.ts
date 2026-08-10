import { randomUUID } from 'node:crypto'
import { fetch } from '@janeirodigital/interop-test-utils'
import { ACL } from '@janeirodigital/interop-utils'
import { test } from 'vitest'
import { ApplicationFactory, Grant } from '../../src'
import { expect } from '../expect'

const factory = new ApplicationFactory({ fetch, randomUUID })
const dataGrantIri = 'https://auth.alice.example/cd247a67-0879-4301-abd0-828f63abb252'

test('should set the iri', async () => {
  const dataGrant = await factory.dataGrant(dataGrantIri)
  expect(dataGrant.id).toBe(dataGrantIri)
})

test('should set the type', async () => {
  const dataGrant = await factory.dataGrant(dataGrantIri)
  expect(dataGrant.type).toContain('http://www.w3.org/ns/solid/interop#DataGrant')
})

test('should set the accessMode', async () => {
  const dataGrant = await factory.dataGrant(dataGrantIri)
  expect(dataGrant.accessMode).toContain(ACL.Read)
  expect(dataGrant.accessMode).toContain(ACL.Write)
})

test('should set the hasDataRegistration', async () => {
  const dataGrant = await factory.dataGrant(dataGrantIri)
  const dataRegistrationIri = 'https://pro.alice.example/773605f0-b5bf-4d46-878d-5c167eac8b5d'
  expect(dataGrant.hasDataRegistration).toBe(dataRegistrationIri)
})

test('should set registeredShapeTree', async () => {
  const dataGrant = await factory.dataGrant(dataGrantIri)
  const projectShapeTree = 'https://solidshapes.example/trees/Project'
  expect(dataGrant.registeredShapeTree).toBe(projectShapeTree)
})
