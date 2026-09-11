import {
  type ApplicationRegistrationData,
  type ApplicationRegistryData,
  type AgentAndClient,
  dataModelContext,
} from '@janeirodigital/interop-data-model'
import {
  type WhatwgFetch,
  createContainer,
  toStore,
  withContext,
} from '@janeirodigital/interop-utils'
import { addApplicationRegistration, findApplicationRegistration } from './agent-registry'
import type { DataModelDependencies } from './types'

// ──────────────────────────
// Write path: ApplicationRegistrationData → container (container.create)
// ──────────────────────────

/**
 * Ensure the grantee has an application registration in the registry
 * (find-first idempotent) — the activity-first granting workflow's app-leg
 * (only Application grantees are auto-registered at grant time;
 * authorization-granting.md Step 2). The grantee kind cannot ride the wire
 * (no `agentType` term), so the workflow infers it (`typeGrantee` failure).
 */
export async function ensureApplicationRegistration(
  applicationRegistry: ApplicationRegistryData,
  deps: DataModelDependencies,
  creator: AgentAndClient,
  registeredAgent: string
): Promise<void> {
  const existing = await findApplicationRegistration(
    applicationRegistry,
    deps.fetch,
    registeredAgent
  )
  if (existing) return
  await addApplicationRegistration(applicationRegistry, deps, creator, registeredAgent)
}

export async function createApplicationRegistration(
  data: ApplicationRegistrationData,
  fetch: WhatwgFetch
): Promise<void> {
  // build the dataset via jsonld.toRDF (withContext + toStore) — the rdf:type
  // quad comes from `data.type` (captured from framing on read), no hand-built
  // DataFactory quads; only the container.create hand-off stays N3-based
  const dataset = await toStore(withContext(dataModelContext, data))
  await createContainer(data.id, fetch, dataset)
}
