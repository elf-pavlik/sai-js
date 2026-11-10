import {
  type AgentAndClient,
  type ApplicationRegistrationData,
  type ApplicationRegistryData,
  dataModelContext,
} from '@janeirodigital/interop-data-model'
import { type WhatwgFetch, postMember, withContext } from '@janeirodigital/interop-utils'

import { addApplicationRegistration, findApplicationRegistration } from './agent-registry.ts'
import type { DataModelDependencies } from './types.ts'

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
  registry: ApplicationRegistryData,
  data: ApplicationRegistrationData,
  fetch: WhatwgFetch
): Promise<void> {
  // flat container member: POST + Slug to the registry (`lws:Container` link)
  // and the store patches nothing — the description is populated by
  // `postMember` with the same `INSERT DATA` patch `createContainer` used
  await postMember(
    registry.id,
    fetch,
    { id: data.id, body: withContext(dataModelContext, data) },
    { container: true }
  )
}
