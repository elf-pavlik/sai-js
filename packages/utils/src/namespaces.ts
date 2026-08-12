import { createVocabulary } from 'rdf-vocabulary'

export const INTEROP = createVocabulary(
  'http://www.w3.org/ns/solid/interop#',
  'accessMode',
  'AccessNeed',
  'AccessNeedDescription',
  'AccessNeedGroup',
  'AccessNeedGroupDescription',
  'AccessRequired',
  'accessNecessity',
  'AgentRegistry',
  'All',
  'AllFromAgent',
  'AllFromRegistry',
  'AllFromRole',
  'Application',
  'ApplicationRegistration',
  'AuthorizationRegistry',
  'creatorAccessMode',
  'DataAuthorization',
  'DataGrant',
  'dataOwner',
  'DataRegistration',
  'DataRegistry',
  'delegationOfGrant',
  'grantedBy',
  'grantee',
  'GrantRegistry',
  'hasAccessAuthorization',
  'hasAccessDescriptionSet',
  'hasAccessNeed',
  'hasAccessNeedGroup',
  'hasAgentRegistry',
  'hasApplicationRegistration',
  'hasAuthorizationAgent',
  'hasAuthorizationCallbackEndpoint',
  'hasAuthorizationRedirectEndpoint',
  'hasAuthorizationRegistry',
  'hasCapabilityUrl',
  'hasDataGrant',
  'hasDataInstance',
  'hasDataRegistration',
  'hasDataRegistry',
  'hasDelegationIssuanceEndpoint',
  'hasGrantRegistry',
  'hasMember',
  'hasRoleRegistry',
  'hasSocialAgentInvitation',
  'hasSocialAgentRegistration',
  'hasStorage',
  'inAccessDescriptionSet',
  'Inherited',
  'inheritsFromAuthorization',
  'inheritsFromGrant',
  'inheritsFromNeed',
  'pushService',
  'Read',
  'reciprocalRegistration',
  'registeredAgent',
  'registeredAt',
  'registeredBy',
  'registeredShapeTree',
  'registeredWith',
  'RegistrySet',
  'Role',
  'RoleRegistry',
  'satisfiesAccessNeed',
  'scopeOfAuthorization',
  'scopeOfGrant',
  'SelectedFromRegistry',
  'SocialAgent',
  'SocialAgentInvitation',
  'SocialAgentRegistration',
  'updatedAt',
  'usesLanguage'
)

export const NOTIFY = createVocabulary(
  'http://www.w3.org/ns/solid/notifications#',
  'vapidPublicKey'
)

export const RDF = createVocabulary('http://www.w3.org/1999/02/22-rdf-syntax-ns#', 'type')

export const RDFS = createVocabulary('http://www.w3.org/2000/01/rdf-schema#', 'label')

export const LDP = createVocabulary('http://www.w3.org/ns/ldp#', 'contains', 'Resource')

export const ACL = createVocabulary(
  'http://www.w3.org/ns/auth/acl#',
  'Create',
  'Delete',
  'Read',
  'Update',
  'Write'
)

export const SHAPETREES = createVocabulary(
  'http://www.w3.org/ns/shapetrees#',
  'describes',
  'describesInstance',
  'Description',
  'expectsType',
  'hasShapeTree',
  'inDescriptionSet',
  'NonRDFResource',
  'references',
  'Resource',
  'shape',
  'ShapeTree',
  'usesLanguage',
  'viaPredicate'
)

export const XSD = createVocabulary(
  'http://www.w3.org/2001/XMLSchema#',
  'dateTime',
  'language',
  'string'
)

export const SKOS = createVocabulary(
  'http://www.w3.org/2004/02/skos/core#',
  'definition',
  'note',
  'prefLabel'
)

export const ACP = createVocabulary(
  'http://www.w3.org/ns/solid/acp#',
  'PublicAgent',
  'PublicClient'
)

export const SOLID = createVocabulary(
  'http://www.w3.org/ns/solid/terms#',
  'oidcIssuer',
  'storageDescription',
  'updatesViaStreamingHttp2023'
)

export const OIDC = createVocabulary('http://www.w3.org/ns/solid/oidc#', 'client_name', 'logo_uri')

export const SPACE = createVocabulary('http://www.w3.org/ns/pim/space#', 'Storage')

export const AS = createVocabulary('https://www.w3.org/ns/activitystreams#', 'object', 'Update')
