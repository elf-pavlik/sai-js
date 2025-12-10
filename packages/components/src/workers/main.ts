import { fileURLToPath } from 'node:url'
import { NativeConnection, Worker } from '@temporalio/worker'
import * as forwardActivities from '../temporal/activities/forward-to-push.js'
import * as reciprocalActivities from '../temporal/activities/reciprocal.js'

async function run() {
  const connection = await NativeConnection.connect({ address: process.env.TEMPORAL_ADDRESS })

  try {
    const forward = await Worker.create({
      connection,
      taskQueue: 'forward-to-push',
      workflowsPath: fileURLToPath(
        new URL('../temporal/workflows/forward-to-push.js', import.meta.url)
      ),
      activities: forwardActivities,
    })

    const reciprocal = await Worker.create({
      connection,
      taskQueue: 'reciprocal-registration',
      workflowsPath: fileURLToPath(new URL('../temporal/workflows/reciprocal.js', import.meta.url)),
      activities: reciprocalActivities,
    })

    // Run both workers simultaneously
    await Promise.all([forward.run(), reciprocal.run()])
  } finally {
    await connection.close()
  }
}

run().catch((err) => {
  console.error(err)
  process.exit(1)
})
