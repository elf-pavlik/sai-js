import type { AuthorizationAgent } from '@janeirodigital/interop-authorization-agent'
import { IRI, Role } from '@janeirodigital/sai-api-messages'
import { Temporal } from '../temporal/client.js'
import { updateGrantsForAgents } from '../temporal/workflows/grants.js'
import type * as S from 'effect/Schema'

async function executeWorkflow(
  webId: string,
  beforePeers: string[],
  afterPeers: string[]
): Promise<void> {
  const before = new Set(beforePeers)
  const after = new Set(afterPeers)
  const affected = [...before.symmetricDifference(after)]
  const temporal = new Temporal()
  await temporal.init()
  await temporal.client.workflow.execute(updateGrantsForAgents, {
    taskQueue: 'create-grants',
    args: [
      {
        webId,
        peers: affected,
      },
    ],
    workflowId: crypto.randomUUID(),
  })
}

export const getRoles = async (saiSession: AuthorizationAgent) => {
  const roles = []
  for await (const registration of saiSession.roles) {
    roles.push(
      Role.make({
        id: IRI.make(registration.iri),
        label: registration.label,
        members: registration.members.map((m) => IRI.make(m)),
      })
    )
  }
  return roles
}

// no workflow since no authorizations can exist before role is created
export const createRole = async (
  saiSession: AuthorizationAgent,
  label: string,
  members: readonly S.Schema.Type<typeof IRI>[]
): Promise<S.Schema.Type<typeof Role>> => {
  const registration = await saiSession.registrySet.hasRoleRegistry.createRole(label, [...members])
  return Role.make({ id: IRI.make(registration.iri), label, members: [...members] })
}

export const updateRole = async (
  saiSession: AuthorizationAgent,
  id: S.Schema.Type<typeof IRI>,
  label: string,
  members: readonly S.Schema.Type<typeof IRI>[]
): Promise<S.Schema.Type<typeof Role>> => {
  const role = await saiSession.factory.crud.role(id)
  await saiSession.registrySet.hasRoleRegistry.updateRole(id, label, [...members])
  // TODO fix IRI type change
  await executeWorkflow(saiSession.webId, role.members, members as unknown as string[])
  return Role.make({ id, label, members: [...members] })
}

export const deleteRole = async (
  saiSession: AuthorizationAgent,
  id: S.Schema.Type<typeof IRI>
): Promise<void> => {
  const role = await saiSession.factory.crud.role(id)
  await saiSession.registrySet.hasRoleRegistry.deleteRole(id)
  // TODO delete authorizations for that role
  await executeWorkflow(saiSession.webId, role.members, [])
}
