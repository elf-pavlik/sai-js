import { seedKeyValue, seedQuadstore } from '@janeirodigital/interop-utils'
import { beforeEach } from 'vitest'

const connectionString = 'postgres://temporal:temporal@postgresql:5432/auth'
const keyValuePath = '../packages/css-storage-fixture/test/kv.json'

const sparqlEndpoint = 'http://sparql/store'
const datasetPath = '../packages/css-storage-fixture/test/registry.trig'

beforeEach(async () => {
  await seedKeyValue(connectionString, keyValuePath)
  await seedQuadstore(sparqlEndpoint, datasetPath)
})
