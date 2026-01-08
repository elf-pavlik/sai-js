
import { Postgres, seedQuadstore, dumpQuadstore, dropQuadstore } from '@janeirodigital/interop-test-utils'

const connectionString = 'postgres://temporal:temporal@localhost:5432/auth'
const keyValuePath = 'packages/css-storage-fixture/dev/kv.json'

const sparqlEndpoint = 'http://localhost:7878/store'
const datasetPath = 'packages/css-storage-fixture/dev/registry.trig'

const pg = new Postgres(connectionString, 'key_value')

await pg.dropTable()
await dropQuadstore(sparqlEndpoint)

await pg.seedKeyValue(keyValuePath)
await seedQuadstore(sparqlEndpoint, datasetPath)

// await pg.dumpKeyValue(keyValuePath)
// await dumpQuadstore(sparqlEndpoint, datasetPath)


process.exit(0)
