import { INTEROP, OIDC, RDF } from '@janeirodigital/interop-utils';
import { NamedNode } from '@rdfjs/types';
import { AgentRegistrationData, CRUDAgentRegistration } from '.';
import { AuthorizationAgentFactory } from '..';
import { DataFactory } from 'n3';

export class CRUDApplicationRegistration extends CRUDAgentRegistration {
  protected async bootstrap(): Promise<void> {
    if (!this.data) {
      await this.fetchData();
    } else {
      this.dataset.add(DataFactory.quad(this.node, RDF.type, INTEROP.ApplicationRegistration));
      this.datasetFromData();
    }
    await this.buildAccessGrant();
  }

  get applicationNode(): NamedNode | undefined {
    return this.getObject('registeredAgent');
  }

  get accessNeedGroup(): string | undefined {
    return this.getQuad(this.applicationNode, INTEROP.hasAccessNeedGroup)?.object.value;
  }

  get hasAuthorizationCallbackEndpoint(): string | undefined {
    return this.getQuad(this.applicationNode, INTEROP.hasAuthorizationCallbackEndpoint)?.object.value;
  }

  get name(): string | undefined {
    return this.getQuad(this.applicationNode, OIDC.client_name)?.object.value;
  }

  get logo(): string | undefined {
    return this.getQuad(this.applicationNode, OIDC.logo_uri)?.object.value;
  }

  public static async build(
    iri: string,
    factory: AuthorizationAgentFactory,
    data?: AgentRegistrationData
  ): Promise<CRUDApplicationRegistration> {
    const instance = new CRUDApplicationRegistration(iri, factory, data);
    await instance.bootstrap();
    return instance;
  }
}
