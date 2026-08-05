import { randomUUID } from 'node:crypto'
import { fetch } from '@janeirodigital/interop-test-utils'
import { test } from 'vitest'
import { ApplicationFactory, DataOwner, type DataOwnerData } from '../src'
import { expect } from './expect'

const factory = new ApplicationFactory({ fetch, randomUUID })

test('should select Registrations', async () => {
  const webid = 'https://acme.example/#corp'
  // Fetch a couple of data grants to populate a DataOwner
  const grantIris = [
    'https://auth.alice.example/cd247a67-0879-4301-abd0-828f63abb252',
    'https://auth.alice.example/9827ae00-2778-4655-9f22-08bb9daaee26',
  ]
  const dataOwner: DataOwnerData = { iri: webid, issuedGrants: [] }
  for (const iri of grantIris) {
    const grant = await factory.readable.dataGrant(iri)
    if (grant.dataOwner === webid) {
      dataOwner.issuedGrants.push(grant)
    }
  }
  const shapeTree = 'https://solidshapes.example/trees/Project'
  expect(DataOwner.selectRegistrations(dataOwner, shapeTree, factory).length).toBeGreaterThanOrEqual(
    0
  )
})
