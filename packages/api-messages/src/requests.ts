import { IRI } from './index';
import { AgentType, Authorization, ShareAuthorization } from './payloads';

export const RequestMessageTypes = {
  HELLO_REQUEST: '[HELLO] Hello Requested',
  APPLICATIONS_REQUEST: '[APPLICATION PROFILES] Application Profiles Requested',
  SOCIAL_AGENTS_REQUEST: '[SOCIAL AGENTS] Application Profiles Requested',
  DESCRIPTIONS_REQUEST: '[DESCRIPTIONS] Descriptions Requested',
  LIST_DATA_INSTANCES_REQUEST: '[LIST DATA INSTANCES] List Data Instances Requested',
  DATA_REGISTRIES_REQUEST: '[DATA_REGISTRIES] Data Registries Requested',
  ADD_SOCIAL_AGENT_REQUEST: '[SOCIAL AGENTS] Data Registries Requested',
  APPLICATION_AUTHORIZATION: '[APPLICATION] Authorization submitted',
  UNREGISTERED_APPLICATION_PROFILE: 'ApplicationProfileRequest',
  RESOURCE_REQUEST: '[RESOURCE] Resource Requested',
  SHARE_AUTHORIZATION: '[RESOURCE] Share Authorization Requested',
  REQUEST_AUTHORIZATION_USING_APPLICATION_NEEDS:
    '[REQUEST AUTHORIZATION USING APPLICATION NEEDS] Request Authorization Using Application Needs Requested',
  SOCIAL_AGENT_INVITATIONS_REQUEST: '[SOCIAL AGENT INVITATIONS] Social Agent Invitations Requested',
  CREATE_INVITATION: '[CREATE INVITATION] Create invitation',
  ACCEPT_INVITATION: '[ACCEPT INVITATION] Accept invitation'
} as const;

abstract class MessageBase {
  stringify(): string {
    return JSON.stringify(this);
  }
}

export class HelloRequest extends MessageBase {
  public type = RequestMessageTypes.HELLO_REQUEST;

  constructor(public subscription?: PushSubscription) {
    super();
  }
}

export class ApplicationsRequest extends MessageBase {
  public type = RequestMessageTypes.APPLICATIONS_REQUEST;
}

export class UnregisteredApplicationProfileRequest extends MessageBase {
  public type = RequestMessageTypes.UNREGISTERED_APPLICATION_PROFILE;

  constructor(private id: IRI) {
    super();
  }
}

export class SocialAgentsRequest extends MessageBase {
  public type = RequestMessageTypes.SOCIAL_AGENTS_REQUEST;
}

export class AddSocialAgentRequest extends MessageBase {
  public type = RequestMessageTypes.ADD_SOCIAL_AGENT_REQUEST;

  constructor(
    public webId: IRI,
    public label: string,
    public note?: string
  ) {
    super();
  }
}

export class DataRegistriesRequest extends MessageBase {
  public type = RequestMessageTypes.DATA_REGISTRIES_REQUEST;

  constructor(
    private agentId: string,
    private lang: string
  ) {
    super();
  }
}

export class DescriptionsRequest extends MessageBase {
  public type = RequestMessageTypes.DESCRIPTIONS_REQUEST;

  constructor(
    private agentId: IRI,
    private agentType: AgentType,
    private lang: string
  ) {
    super();
  }
}

export class ListDataInstancesRequest extends MessageBase {
  public type = RequestMessageTypes.LIST_DATA_INSTANCES_REQUEST;

  constructor(
    private agentId: string,
    private registrationId: IRI
  ) {
    super();
  }
}

export class ApplicationAuthorizationRequest extends MessageBase {
  public type = RequestMessageTypes.APPLICATION_AUTHORIZATION;

  constructor(private authorization: Authorization) {
    super();
  }
}

export class ResourceRequest extends MessageBase {
  public type = RequestMessageTypes.RESOURCE_REQUEST;

  constructor(
    public id: IRI,
    private lang: string
  ) {
    super();
  }
}

export class ShareAuthorizationRequest extends MessageBase {
  public type = RequestMessageTypes.SHARE_AUTHORIZATION;

  constructor(private shareAuthorization: ShareAuthorization) {
    super();
  }
}

export class RequestAccessUsingApplicationNeedsRequest extends MessageBase {
  public type = RequestMessageTypes.REQUEST_AUTHORIZATION_USING_APPLICATION_NEEDS;

  constructor(
    private applicationId: IRI,
    private agentId: IRI
  ) {
    super();
  }
}

export class SocialAgentInvitationsRequest extends MessageBase {
  public type = RequestMessageTypes.SOCIAL_AGENT_INVITATIONS_REQUEST;
}

export class CreateInvitationRequest extends MessageBase {
  public type = RequestMessageTypes.CREATE_INVITATION;

  constructor(
    private label: string,
    private note?: string
  ) {
    super();
  }
}

export class AcceptInvitationRequest extends MessageBase {
  public type = RequestMessageTypes.ACCEPT_INVITATION;

  constructor(
    private capabilityUrl: IRI,
    private label: string,
    private note?: string
  ) {
    super();
  }
}

export type Request =
  | HelloRequest
  | ApplicationsRequest
  | SocialAgentsRequest
  | AddSocialAgentRequest
  | DataRegistriesRequest
  | DescriptionsRequest
  | ListDataInstancesRequest
  | ApplicationAuthorizationRequest
  | UnregisteredApplicationProfileRequest
  | ResourceRequest
  | ShareAuthorizationRequest
  | RequestAccessUsingApplicationNeedsRequest
  | SocialAgentInvitationsRequest
  | CreateInvitationRequest
  | AcceptInvitationRequest;
