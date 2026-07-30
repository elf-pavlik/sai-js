import { INTEROP, discoverAccessResource, parseTurtle } from '@janeirodigital/interop-utils'
import { DataFactory } from 'n3'
import { Mixin } from 'ts-mixer'
import type { AuthorizationAgentFactory, GrantData } from '..'
import { AgentRegistrationGetters } from '../mixins/agent-registration-getters'
import { agentRegistrationAcrTemplate } from '../templates/AgentRegistration.acr'
import type { AgentAndClient } from '../templates/types'
import { CRUDContainer } from './container'

export type AgentRegistrationData = {
  registeredAgent: string
  hasDataGrant?: string[]
}

export abstract class CRUDAgentRegistration extends Mixin(CRUDContainer, AgentRegistrationGetters) {
  declare data?: AgentRegistrationData

  declare factory: AuthorizationAgentFactory

  async setAcr(owner: AgentAndClient, peer: AgentAndClient): Promise<void> {
    const acrLocation = await discoverAccessResource(this.iri, this.factory.fetch)
    const dataset = await parseTurtle(
      agentRegistrationAcrTemplate({
        id: this.iri,
        owner,
        peer,
      })
    )
    const response = await this.fetch(acrLocation, {
      method: 'PUT',
      dataset,
    })
    if (!response.ok) throw new Error(await response.text())
  }

  protected datasetFromData(): void {
    if (this.data.registeredAgent) {
      this.dataset.add(
        DataFactory.quad(
          DataFactory.namedNode(this.iri),
          INTEROP.registeredAgent,
          DataFactory.namedNode(this.data.registeredAgent)
        )
      )
    }
    if (this.data.hasDataGrant) {
      for (const grantIri of this.data.hasDataGrant) {
        this.dataset.add(
          DataFactory.quad(
            DataFactory.namedNode(this.iri),
            INTEROP.hasDataGrant,
            DataFactory.namedNode(grantIri)
          )
        )
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Standalone functional helpers for managing hasDataGrant on registrations
// ---------------------------------------------------------------------------

export function getDataGrantIris(registration: CRUDAgentRegistration): string[] {
  return registration.getObjectsArray(INTEROP.hasDataGrant).map((node) => node.value)
}

export function getGranted(registration: CRUDAgentRegistration): boolean {
  return getDataGrantIris(registration).length > 0
}

export async function getDataGrants(
  registration: CRUDAgentRegistration
): Promise<GrantData[]> {
  const iris = getDataGrantIris(registration)
  return Promise.all(iris.map((iri) => registration.factory.readable.dataGrant(iri)))
}

export async function addDataGrant(
  registration: CRUDAgentRegistration,
  grantIri: string
): Promise<void> {
  const quad = DataFactory.quad(
    DataFactory.namedNode(registration.iri),
    INTEROP.hasDataGrant,
    DataFactory.namedNode(grantIri)
  )
  await registration.addStatement(quad)
}

export async function removeDataGrant(
  registration: CRUDAgentRegistration,
  grantIri: string
): Promise<void> {
  const quad = registration.getQuad(
    DataFactory.namedNode(registration.iri),
    INTEROP.hasDataGrant,
    DataFactory.namedNode(grantIri)
  )
  if (quad) {
    await registration.removeStatement(quad)
  }
}

export async function removeAllDataGrants(
  registration: CRUDAgentRegistration
): Promise<void> {
  const iris = getDataGrantIris(registration)
  await Promise.all(iris.map((iri) => removeDataGrant(registration, iri)))
}
