import type { AuthorizationAgent } from '@janeirodigital/interop-authorization-agent'
import { IRI, Role } from '@janeirodigital/sai-api-messages'
import type * as S from 'effect/Schema'

export const getRoles = async (saiSession: AuthorizationAgent) => {
  const roles = []
  for await (const registration of saiSession.roleRegistrations) {
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
  await saiSession.registrySet.hasRoleRegistry.updateRole(id, label, [...members])
  return Role.make({ id, label, members: [...members] })
}

export const deleteRole = async (
  saiSession: AuthorizationAgent,
  id: S.Schema.Type<typeof IRI>
): Promise<void> => {
  await saiSession.registrySet.hasRoleRegistry.deleteRole(id)
}
