import 'dotenv/config'
import { NativeConnection, Worker } from '@temporalio/worker'
import * as activities from '../temporal/activities/forward-to-push'

async function run() {
  const connection = await NativeConnection.connect({ address: process.env.TEMPORAL_ADDRESS })
  try {
    const worker = await Worker.create({
      connection,
      taskQueue: 'forward-to-push',
      workflowsPath: require.resolve('../temporal/workflows/forward-to-push'),
      activities,
    })
    await worker.run()
  } finally {
    await connection.close()
  }
}

run().catch((err) => {
  console.error(err)
  process.exit(1)
})
