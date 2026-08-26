import { ActivityRegistry, RoleRegistry } from '@janeirodigital/interop-data-model'
import { INTEROP } from '@janeirodigital/interop-utils'
import { IRI, Role } from '@janeirodigital/sai-api-messages'
import type * as S from 'effect/Schema'
import type { ResolvedContext } from './Context.js'

export const getRoles = async (ctx: ResolvedContext) => {
  const roles = []
  for await (const registration of RoleRegistry.roles(
    ctx.registrySet.hasRoleRegistry,
    ctx.session.factory
  )) {
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
  ctx: ResolvedContext,
  label: string,
  members: readonly S.Schema.Type<typeof IRI>[]
): Promise<S.Schema.Type<typeof Role>> => {
  const registration = await RoleRegistry.createRole(
    ctx.registrySet.hasRoleRegistry,
    ctx.session.factory,
    label,
    [...members]
  )
  return Role.make({ id: IRI.make(registration.id), label, members: [...members] })
}

export const updateRole = async (
  ctx: ResolvedContext,
  id: S.Schema.Type<typeof IRI>,
  label: string,
  members: readonly S.Schema.Type<typeof IRI>[]
): Promise<S.Schema.Type<typeof Role>> => {
  const role = await ctx.session.factory.role(id)
  await RoleRegistry.updateRole(
    ctx.registrySet.hasRoleRegistry,
    ctx.session.factory,
    id,
    label,
    [...members]
  )
  const before = new Set(role.members)
  const after = new Set(members)
  const affected = [...before.symmetricDifference(after)]
  if (affected.length) {
    const activityRegistry = ctx.registrySet.hasActivityRegistry
    if (!activityRegistry) throw new Error('activity registry not found in registry set')
    await ActivityRegistry.createActivity(activityRegistry, ctx.session.factory, {
      activityType: 'roleMembershipChanged',
      target: id,
      payload: {
        webId: { id: ctx.webId, type: [INTEROP.SocialAgent] },
        roleId: { id, type: [INTEROP.Role] },
        peers: affected.map((member) => ({
          id: member,
          type: [INTEROP.SocialAgent],
        })),
      },
      createdAt: new Date().toISOString(),
    })
  }
  return Role.make({ id, label, members: [...members] })
}

export const deleteRole = async (
  ctx: ResolvedContext,
  id: S.Schema.Type<typeof IRI>
): Promise<void> => {
  const role = await ctx.session.factory.role(id)
  await RoleRegistry.deleteRole(ctx.registrySet.hasRoleRegistry, ctx.session.factory, id)
  const activityRegistry = ctx.registrySet.hasActivityRegistry
  if (!activityRegistry) throw new Error('activity registry not found in registry set')
  await ActivityRegistry.createActivity(activityRegistry, ctx.session.factory, {
    activityType: 'roleDeleted',
    target: id,
    payload: {
      webId: { id: ctx.webId, type: [INTEROP.SocialAgent] },
      roleId: { id, type: [INTEROP.Role] },
      // former members — unresolvable after deletion (the service read the role before deleting)
      peers: role.members.map((member) => ({
        id: member,
        type: [INTEROP.SocialAgent],
      })),
    },
    createdAt: new Date().toISOString(),
  })
}