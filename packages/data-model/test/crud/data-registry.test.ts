import { randomUUID } from 'node:crypto'
import { fetch } from '@janeirodigital/interop-test-utils'
import { test } from 'vitest'
import { DataRegistry } from '../../src'
import { expect } from '../expect'

const deps = { fetch, randomUUID }
const snippetIri = 'https://home.alice.example/2d3d97b4-a26d-434e-afa2-e3bc8e8e2b56/'

test('storageIri', async () => {
  const dataRegistry = { id: snippetIri }
  const iri = await DataRegistry.storageIri(dataRegistry, deps.fetch)
  expect(iri).toBe('https://fake.example/storage-desription')
})
