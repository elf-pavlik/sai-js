import { SKOS, INTEROP } from '@janeirodigital/interop-namespaces';
import { discoverAuthorizationAgent, discoverAgentRegistration, WhatwgFetch } from '@janeirodigital/interop-utils';
import { DataFactory } from 'n3';
import { AgentRegistrationData, CRUDAgentRegistration } from '.';
import { AuthorizationAgentFactory } from '..';

type ClassData = {
  prefLabel: string;
  note?: string;
};

export type SocialAgentRegistrationData = AgentRegistrationData & ClassData;

export class CRUDSocialAgentRegistration extends CRUDAgentRegistration {
  data?: SocialAgentRegistrationData;

  reciprocalRegistration?: CRUDSocialAgentRegistration;

  reciprocal: boolean;

  public constructor(
    iri: string,
    factory: AuthorizationAgentFactory,
    reciprocal: boolean,
    data?: SocialAgentRegistrationData
  ) {
    super(iri, factory, data);
    this.reciprocal = reciprocal;
  }

  // TODO (elf-pavlik) recover if reciprocal can't be fetched
  private async buildReciprocalRegistration(): Promise<void> {
    const reciprocalRegistrationIri = this.getObject(INTEROP.reciprocalRegistration)?.value;
    if (reciprocalRegistrationIri) {
      this.reciprocalRegistration = await this.factory.crud.socialAgentRegistration(reciprocalRegistrationIri, true);
    }
  }

  // TODO: adjust factory to also expose WhatwgFetch
  public async discoverReciprocal(fetch: WhatwgFetch): Promise<string | null> {
    const authrizationAgentIri = await discoverAuthorizationAgent(this.registeredAgent, this.factory.fetch);
    if (!authrizationAgentIri) return null;
    return discoverAgentRegistration(authrizationAgentIri, fetch);
  }

  protected datasetFromData(): void {
    super.datasetFromData();
    const props: (keyof ClassData)[] = ['prefLabel', 'note'];
    for (const prop of props) {
      if (this.data[prop]) {
        this.dataset.add(
          DataFactory.quad(DataFactory.namedNode(this.iri), SKOS[prop], DataFactory.literal(this.data[prop]))
        );
      }
    }
  }

  protected async bootstrap(): Promise<void> {
    if (!this.data) {
      await this.fetchData();
    } else {
      this.datasetFromData();
    }
    await this.buildAccessGrant();
    if (!this.reciprocal) {
      await this.buildReciprocalRegistration();
    }
  }

  public static async build(
    iri: string,
    factory: AuthorizationAgentFactory,
    reciprocal: boolean,
    data?: SocialAgentRegistrationData
  ): Promise<CRUDSocialAgentRegistration> {
    const instance = new CRUDSocialAgentRegistration(iri, factory, reciprocal, data);
    await instance.bootstrap();
    return instance;
  }
}
