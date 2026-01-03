
import { seedKeyValue, seedQuadstore, dumpKeyValue, dumpQuadstore, dropKeyValue, dropQuadstore } from '@janeirodigital/interop-test-utils'

const connectionString = 'postgres://temporal:temporal@localhost:5432/auth'
const keyValuePath = 'packages/css-storage-fixture/dev/kv.json'

const sparqlEndpoint = 'http://localhost:7878/store'
const datasetPath = 'packages/css-storage-fixture/dev/registry.trig'

await seedKeyValue(connectionString, keyValuePath)
await seedQuadstore(sparqlEndpoint, datasetPath)

// await dumpKeyValue(connectionString, keyValuePath)
// await dumpQuadstore(sparqlEndpoint, datasetPath)

// await dropKeyValue(connectionString)
// await dropQuadstore(sparqlEndpoint)

process.exit(0)
