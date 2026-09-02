import { ActivityRegistry, RoleRegistry } from '@janeirodigital/interop-authorization-agent'
import {
  type RoleData,
  type RoleDeleted,
  type RoleMembershipChanged,
  loadRole,
} from '@janeirodigital/interop-data-model'
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
    // `target` ≡ the role (live link); the affected members ride the object
    // as a plain-IRI set (A-carrier — steps 4–5 move the diff derivation into
    // the workflow and pin the carrier)
    const activity: Omit<RoleMembershipChanged, 'id'> = {
      type: ['Activity', 'RoleMembershipChanged'],
      actor: ctx.webId,
      target: id,
      object: affected,
      createdAt: new Date().toISOString(),
    }
    await ActivityRegistry.createActivity(
      activityRegistry,
      { fetch: ctx.session.fetch, randomUUID: ctx.session.randomUUID },
      activity
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
  // `target` ≡ the role; `object` = the former members (plain-IRI set —
  // unresolvable after deletion, the service read the role before deleting)
  const activity: Omit<RoleDeleted, 'id'> = {
    type: ['Activity', 'RoleDeleted'],
    actor: ctx.webId,
    target: id,
    object: role.members,
    createdAt: new Date().toISOString(),
  }
  await ActivityRegistry.createActivity(
    activityRegistry,
    { fetch: ctx.session.fetch, randomUUID: ctx.session.randomUUID },
    activity
  )
}
