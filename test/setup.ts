import { Postgres, seedQuadstore } from '@janeirodigital/interop-test-utils'
import { beforeEach } from 'vitest'

const connectionString = 'postgres://temporal:temporal@postgresql:5432/auth'
const keyValuePath = '../packages/css-storage-fixture/test/kv.json'

const sparqlEndpoint = 'http://sparql/store'
const datasetPath = '../packages/css-storage-fixture/test/registry.trig'

const pg = new Postgres(connectionString, 'key_value')
beforeEach(async () => {
  await pg.seedKeyValue(keyValuePath)
  await seedQuadstore(sparqlEndpoint, datasetPath)
})
