import type { AuthorizationAgent } from '@janeirodigital/interop-authorization-agent'
import { RoleRegistry } from '@janeirodigital/interop-data-model'
import { INTEROP } from '@janeirodigital/interop-utils'
import { IRI, Role } from '@janeirodigital/sai-api-messages'
import type * as S from 'effect/Schema'
import { Temporal } from '../temporal/client.js'
import { processRoleDeletion, processRoleMembershipChange } from '../temporal/workflows/grants.js'

export const getRoles = async (saiSession: AuthorizationAgent) => {
  const roles = []
  for await (const registration of saiSession.roles) {
    roles.push(
      Role.make({
        id: IRI.make(registration.id),
        label: registration.prefLabel,
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
  const registration = await RoleRegistry.createRole(
    saiSession.registrySet.hasRoleRegistry,
    saiSession.factory,
    label,
    [...members]
  )
  return Role.make({ id: IRI.make(registration.id), label, members: [...members] })
}

export const updateRole = async (
  saiSession: AuthorizationAgent,
  id: S.Schema.Type<typeof IRI>,
  label: string,
  members: readonly S.Schema.Type<typeof IRI>[]
): Promise<S.Schema.Type<typeof Role>> => {
  const role = await saiSession.factory.role(id)
  await RoleRegistry.updateRole(
    saiSession.registrySet.hasRoleRegistry,
    saiSession.factory,
    id,
    label,
    [...members]
  )
  const before = new Set(role.members)
  const after = new Set(members)
  const affected = [...before.symmetricDifference(after)]
  if (affected.length) {
    const temporal = new Temporal()
    await temporal.init()
    await temporal.client.workflow.execute(processRoleMembershipChange, {
      taskQueue: 'create-grants',
      args: [
        {
          webId: { id: saiSession.webId, type: [INTEROP.SocialAgent] },
          roleId: { id, type: [INTEROP.Role] },
          peers: affected.map((member) => ({
            id: member,
            type: [INTEROP.SocialAgent],
          })),
        },
      ],
      workflowId: crypto.randomUUID(),
    })
  }
  return Role.make({ id, label, members: [...members] })
}

export const deleteRole = async (
  saiSession: AuthorizationAgent,
  id: S.Schema.Type<typeof IRI>
): Promise<void> => {
  const role = await saiSession.factory.role(id)
  await RoleRegistry.deleteRole(saiSession.registrySet.hasRoleRegistry, saiSession.factory, id)
  const temporal = new Temporal()
  await temporal.init()
  await temporal.client.workflow.execute(processRoleDeletion, {
    taskQueue: 'create-grants',
    args: [
      {
        webId: { id: saiSession.webId, type: [INTEROP.SocialAgent] },
        roleId: { id, type: [INTEROP.Role] },
        peers: role.members.map((member) => ({
          id: member,
          type: [INTEROP.SocialAgent],
        })),
      },
    ],
    workflowId: crypto.randomUUID(),
  })
}
