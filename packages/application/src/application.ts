import { SubscriptionClient } from '@solid-notifications/subscription';
import { ApplicationFactory, ReadableApplicationRegistration, DataOwner } from '@janeirodigital/interop-data-model';
import {
  WhatwgFetch,
  RdfFetch,
  fetchWrapper,
  discoverAuthorizationAgent,
  discoverAgentRegistration,
  discoverAuthorizationRedirectEndpoint,
  NOTIFY
} from '@janeirodigital/interop-utils';

interface ApplicationDependencies {
  fetch: WhatwgFetch;
  randomUUID(): string;
}

export interface SaiEvent {
  type: string;
}

export class Application {
  factory: ApplicationFactory;

  rawFetch: WhatwgFetch;

  fetch: RdfFetch;

  private transformStream: TransformStream;

  private writeableStream: WritableStream<SaiEvent>;

  public stream: ReadableStream<SaiEvent>;

  authorizationAgentIri: string;

  authorizationRedirectEndpoint: string;

  registrationIri: string;

  // TODO rename
  hasApplicationRegistration?: ReadableApplicationRegistration;

  constructor(public webId: string, public applicationId: string, dependencies: ApplicationDependencies) {
    this.rawFetch = dependencies.fetch;
    this.fetch = fetchWrapper(this.rawFetch);
    this.factory = new ApplicationFactory({ fetch: this.fetch, randomUUID: dependencies.randomUUID });
    this.transformStream = new TransformStream();
    this.stream = this.transformStream.readable;
    this.writeableStream = this.transformStream.writable;
  }

  private async bootstrap(): Promise<void> {
    this.authorizationAgentIri = await discoverAuthorizationAgent(this.webId, this.fetch);
    this.registrationIri = await discoverAgentRegistration(this.authorizationAgentIri, this.rawFetch);
    this.authorizationRedirectEndpoint = await discoverAuthorizationRedirectEndpoint(
      this.authorizationAgentIri,
      this.rawFetch
    );
    if (!this.registrationIri) return;
    await this.buildRegistration();
    await this.subscribeToRegistration();
  }

  private async buildRegistration(): Promise<void> {
    if (this.registrationIri) {
      this.hasApplicationRegistration = await this.factory.readable.applicationRegistration(this.registrationIri);
    }
  }

  // TODO: fail gracefully
  private async subscribeToRegistration(): Promise<void> {
    const subscriptionClient = new SubscriptionClient(this.fetch);
    const channel = await subscriptionClient.subscribe(this.registrationIri, NOTIFY.WebSocketChannel2023.value);
    // TODO: move Web Socket to a Web Worker
    const websocket = new WebSocket(channel.receiveFrom);
    websocket.onmessage = async (evt) => {
      const data = JSON.parse(evt.data);
      if (data.type === 'Update') {
        await this.buildRegistration();
        this.writeableStream.getWriter().write({ type: 'GRANT' });
      }
    };
  }

  get authorizationRedirectUri(): string {
    return `${this.authorizationRedirectEndpoint}?client_id=${encodeURIComponent(this.applicationId)}`;
  }

  getShareUri(resourceIri: string): string {
    return `${this.authorizationRedirectEndpoint}?resource=${encodeURIComponent(
      resourceIri
    )}&client_id=${encodeURIComponent(this.applicationId)}`;
  }

  static async build(
    webId: string,
    applicationId: string,
    dependencies: ApplicationDependencies
  ): Promise<Application> {
    const application = new Application(webId, applicationId, dependencies);
    await application.bootstrap();
    return application;
  }

  /**
   * Array of DataOwner instances out of all the data application can access.
   * @public
   */
  get dataOwners(): DataOwner[] {
    if (!this.hasApplicationRegistration) return [];
    return this.hasApplicationRegistration.hasAccessGrant.hasDataGrant.reduce((acc, grant) => {
      let owner: DataOwner = acc.find((agent) => agent.iri === grant.dataOwner);
      if (!owner) {
        owner = new DataOwner(grant.dataOwner);
        acc.push(owner);
      }
      owner.issuedGrants.push(grant);
      return acc;
    }, []);
  }
}
