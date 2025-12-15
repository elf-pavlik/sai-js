import { buildSessionManager } from '../../builders/sessionManager.js'

export interface FindAffectedAuthorizationsInput {
  webId: string
  peerId: string
}

export interface UpdateGrantsInput {
  webId: string
  authorizationId: string
}

export async function findAffectedAuthorizations(
  payload: FindAffectedAuthorizationsInput
): Promise<UpdateGrantsInput[]> {
  const manager = buildSessionManager()
  const session = await manager.getSession(payload.webId)
  const affectedAuthorizations =
    await session.registrySet.hasAuthorizationRegistry.findAuthorizationsDelegatingFromOwner(
      payload.peerId
    )
  return affectedAuthorizations.map((authorization) => ({
    webId: payload.webId,
    authorizationId: authorization.iri,
  }))
}

export async function updateGrants(payload: UpdateGrantsInput): Promise<void> {
  const manager = buildSessionManager()
  const session = await manager.getSession(payload.webId)
  await session.generateAccessGrant(payload.authorizationId)
}
