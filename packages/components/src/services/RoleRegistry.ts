import { ActivityRegistry, RoleRegistry } from '@janeirodigital/interop-authorization-agent'
import { type RoleData, loadRole } from '@janeirodigital/interop-data-model'
import { INTEROP } from '@janeirodigital/interop-utils'
import { IRI, Role } from '@janeirodigital/sai-api-messages'
import type * as S from 'effect/Schema'
import type { ResolvedContext } from './Context.js'
import { getRole, listContained, sparqlTransportFor } from './queries/org.js'

/**
 * The context's roles via SPARQL — personal context reads the session's
 * internal endpoint, org context the org's `/sparql-admin`
 * (`sparqlTransportFor`): role bodies live in their own graphs (keyed by
 * the role IRI), so the listing is `listContained` + one graph read per
 * role (docs/sparql.md step 1). Write paths (create/update/delete) stay
 * REST/LDP via the data-model RoleRegistry.
 */
export const getRoles = async (ctx: ResolvedContext) => {
  const transport = sparqlTransportFor(ctx)
  const iris = await listContained(transport, ctx.registrySet.hasRoleRegistry.id)
  const registrations = (await Promise.all(iris.map((iri) => getRole(transport, iri)))).filter(
    (role): role is RoleData => role !== undefined
  )
  return registrations.map((registration) =>
    Role.make({
      id: IRI.make(registration.id),
      label: registration.prefLabel,
      members: registration.members.map((m) => IRI.make(m)),
    })
  )
}

// no workflow since no authorizations can exist before role is created
export const createRole = async (
  ctx: ResolvedContext,
  label: string,
  members: readonly S.Schema.Type<typeof IRI>[]
): Promise<S.Schema.Type<typeof Role>> => {
  const registration = await RoleRegistry.createRole(
    ctx.registrySet.hasRoleRegistry,
    { fetch: ctx.session.fetch, randomUUID: ctx.session.randomUUID },
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
  const role = await loadRole(id, ctx.session.fetch)
  await RoleRegistry.updateRole(ctx.registrySet.hasRoleRegistry, ctx.session.fetch, id, label, [
    ...members,
  ])
  const before = new Set(role.members)
  const after = new Set(members)
  const affected = [...before.symmetricDifference(after)]
  if (affected.length) {
    const activityRegistry = ctx.registrySet.hasActivityRegistry
    if (!activityRegistry) throw new Error('activity registry not found in registry set')
    await ActivityRegistry.createActivity(
      activityRegistry,
      { fetch: ctx.session.fetch, randomUUID: ctx.session.randomUUID },
      {
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
      }
    )
  }
  return Role.make({ id, label, members: [...members] })
}

export const deleteRole = async (
  ctx: ResolvedContext,
  id: S.Schema.Type<typeof IRI>
): Promise<void> => {
  const role = await loadRole(id, ctx.session.fetch)
  await RoleRegistry.deleteRole(ctx.registrySet.hasRoleRegistry, ctx.session.fetch, id)
  const activityRegistry = ctx.registrySet.hasActivityRegistry
  if (!activityRegistry) throw new Error('activity registry not found in registry set')
  await ActivityRegistry.createActivity(
    activityRegistry,
    { fetch: ctx.session.fetch, randomUUID: ctx.session.randomUUID },
    {
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
    }
  )
}
