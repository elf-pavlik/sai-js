import { buildSessionManager } from '@elfpavlik/sai-components'
import {
  getSocialAgentRegistration,
  localSparqlTransport,
} from '@janeirodigital/interop-authorization-agent'
import { ActivityRegistry, getDataGrantIris } from '@janeirodigital/interop-data-model'
import { INTEROP } from '@janeirodigital/interop-utils'
import { Client, Connection } from '@temporalio/client'
import { describe, expect, test } from 'vitest'
import { waitFor } from './util'

const acmeId = 'https://id/acme'
const aliceId = 'https://id/alice'
const acmeRegForAlice = 'https://registry/acme/agent/je0s7n/'
const seedGrant = 'https://registry/acme/grant/g4yhtm'

describe('reconciliation sweep', () => {
  test('processes a pending activity that was never delivered', async () => {
    const manager = buildSessionManager()
    const acmeSession = await manager.getSession(acmeId)

    // acme has NO pre-seeded activity-webhook channel → CSS never delivers →
    // the activity stays unprocessed until the sweep processes it
    const registry = acmeSession.registrySet.hasActivityRegistry!
    const activity = await ActivityRegistry.createActivity(
      registry,
      { fetch: acmeSession.fetch, randomUUID: acmeSession.randomUUID },
      {
        activityType: 'authorizationRecorded',
        target: acmeSession.registrySet.hasAuthorizationRegistry.id,
        payload: {
          webId: { id: acmeId, type: [INTEROP.SocialAgent] },
          authorizationGrantee: { id: aliceId, type: [INTEROP.SocialAgent] },
        },
        createdAt: new Date().toISOString(),
      }
    )

    // run the sweep (executed by workflow type name — registered on the worker)
    const connection = await Connection.connect({
      address: process.env.TEMPORAL_ADDRESS ?? 'temporal:7233',
    })
    const client = new Client({ connection })
    await client.workflow.execute('reconcileActivities', {
      taskQueue: 'create-grants',
      args: [{ webId: { id: acmeId, type: [INTEROP.SocialAgent] } }],
      workflowId: 'reconciliation-test',
    })

    // the consumer drained it: a completion referencing the activity exists,
    // and alice's grants regenerated
    await waitFor(
      async () => {
        const completed = await ActivityRegistry.getCompletedActivityIris(
          registry,
          acmeSession.fetch
        )
        return completed.includes(activity.id)
      },
      { timeout: 30_000 }
    )
    const regForAlice = await getSocialAgentRegistration(
      localSparqlTransport(acmeSession.sparqlEndpoint),
      acmeRegForAlice
    )
    const iris = await getDataGrantIris(regForAlice)
    expect(iris.length).toBeGreaterThan(0)
    // full regeneration replaced the seed grant with freshly generated ones
    expect(iris).not.toContain(seedGrant)
  })
})
