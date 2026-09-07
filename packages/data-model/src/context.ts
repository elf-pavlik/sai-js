import {
  AS,
  INTEROP,
  type JsonLdContext,
  LDP,
  OIDC,
  SHAPETREES,
  SKOS,
  SOLID,
  createVocabulary,
} from '@janeirodigital/interop-utils'

const NFO = createVocabulary(
  'http://www.semanticdesktop.org/ontologies/2007/03/22/nfo#',
  'fileName'
)

/**
 * JSON-LD term definition with IRI coercion (`@type: '@id'`): values compact
 * to plain IRI strings in framed output. `set: true` adds
 * `@container: '@set'` (always-array). Terms are generated from the shared
 * namespaces instead of hand-written IRI strings (single source of truth).
 *
 * `@reverse` terms and literal terms (no coercion) stay explicit object
 * literals, e.g. `label: { '@id': SKOS.prefLabel }`.
 */
const iriTermDef = (
  ns: any,
  name: string,
  { set = false }: { set?: boolean } = {}
): Record<string, string> => ({
  '@id': ns[name],
  '@type': '@id',
  ...(set ? { '@container': '@set' } : {}),
})

/**
 * The single JSON-LD context shared by every data model in this package —
 * reads (framing via `frameDoc`/`buildFrame`) and writes (`withContext`) alike.
 * It is a superset of all per-model term needs: extra term definitions are
 * inert for `toRDF` (only present keys expand) and for frame matching
 * (`requireAll=false`, `@id` forces the match).
 *
 * No `@version: 1.1` (all features used are 1.0) and no `@protected` —
 * per-model spread-overrides (data-instance `label`) must stay possible.
 */
export const dataModelContext: JsonLdContext = {
  id: '@id',
  type: '@type',

  // interop — single-value node references
  grantee: iriTermDef(INTEROP, 'grantee'),
  grantedBy: iriTermDef(INTEROP, 'grantedBy'),
  dataOwner: iriTermDef(INTEROP, 'dataOwner'),
  registeredShapeTree: iriTermDef(INTEROP, 'registeredShapeTree'),
  hasDataRegistration: iriTermDef(INTEROP, 'hasDataRegistration'),
  hasStorage: iriTermDef(INTEROP, 'hasStorage'),
  scopeOfGrant: iriTermDef(INTEROP, 'scopeOfGrant'),
  scopeOfAdminGrant: iriTermDef(INTEROP, 'scopeOfAdminGrant'),
  scopeOfAuthorization: iriTermDef(INTEROP, 'scopeOfAuthorization'),
  satisfiesAccessNeed: iriTermDef(INTEROP, 'satisfiesAccessNeed'),
  inheritsFromGrant: iriTermDef(INTEROP, 'inheritsFromGrant'),
  delegationOfGrant: iriTermDef(INTEROP, 'delegationOfGrant'),
  inheritsFromAuthorization: iriTermDef(INTEROP, 'inheritsFromAuthorization'),
  inheritsFromNeed: iriTermDef(INTEROP, 'inheritsFromNeed'),
  required: iriTermDef(INTEROP, 'accessNecessity'),
  hasAccessNeed: iriTermDef(INTEROP, 'hasAccessNeed', { set: true }),
  hasAccessNeedGroup: iriTermDef(INTEROP, 'hasAccessNeedGroup'),
  capabilityUrl: iriTermDef(INTEROP, 'hasCapabilityUrl'),
  registeredAgent: iriTermDef(INTEROP, 'registeredAgent'),
  hasDataGrant: iriTermDef(INTEROP, 'hasDataGrant', { set: true }),
  hasAdminGrant: iriTermDef(INTEROP, 'hasAdminGrant', { set: true }),
  hasSocialAgentRegistry: iriTermDef(INTEROP, 'hasSocialAgentRegistry'),
  hasApplicationRegistry: iriTermDef(INTEROP, 'hasApplicationRegistry'),
  hasInvitationRegistry: iriTermDef(INTEROP, 'hasInvitationRegistry'),
  members: iriTermDef(INTEROP, 'hasMember', { set: true }),
  reciprocalRegistration: iriTermDef(INTEROP, 'reciprocalRegistration'),
  hasAuthorizationRegistry: iriTermDef(INTEROP, 'hasAuthorizationRegistry'),
  hasGrantRegistry: iriTermDef(INTEROP, 'hasGrantRegistry'),
  hasRoleRegistry: iriTermDef(INTEROP, 'hasRoleRegistry'),
  hasDataRegistry: iriTermDef(INTEROP, 'hasDataRegistry', { set: true }),
  hasActivityRegistry: iriTermDef(INTEROP, 'hasActivityRegistry'),
  hasAccessRequestRegistry: iriTermDef(INTEROP, 'hasAccessRequestRegistry'),
  callbackEndpoint: iriTermDef(INTEROP, 'hasAuthorizationCallbackEndpoint'),

  // activity registry (outbox) — payload-contract-alignment wire: typed
  // classes + as:target/as:object links, plain-IRI/literal fields. The
  // `as:` prefix resolves the ASV activity types in the `type` tuple
  // (`as:Accept`, `as:Create`, `as:Add`) to compact IRIs on read; the
  // retired `interop:activityType` / `interop:payload` terms are gone.
  as: 'https://www.w3.org/ns/activitystreams#',
  actor: iriTermDef(AS, 'actor'),
  target: iriTermDef(AS, 'target'),
  object: iriTermDef(AS, 'object'),
  createdAt: { '@id': INTEROP.createdAt },

  // activity classes — rdf:type values compact to these bare terms so the
  // typed ActivityData unions frame as `type: ['Activity', '<Class>', <as:*>]`.
  Activity: { '@id': INTEROP.Activity },
  InvitationAccepted: { '@id': INTEROP.InvitationAccepted },
  InvitationCreated: { '@id': INTEROP.InvitationCreated },
  AgentRegistrationAdded: { '@id': INTEROP.AgentRegistrationAdded },
  AdminAuthorizationRecorded: { '@id': INTEROP.AdminAuthorizationRecorded },
  AdminAuthorizationRevoked: { '@id': INTEROP.AdminAuthorizationRevoked },
  AuthorizationRecorded: { '@id': INTEROP.AuthorizationRecorded },
  AuthorizationRevoked: { '@id': INTEROP.AuthorizationRevoked },
  NeedBasedAccessRequest: { '@id': INTEROP.NeedBasedAccessRequest },
  NeedBasedAccessRequestReceived: { '@id': INTEROP.NeedBasedAccessRequestReceived },
  NeedBasedAccessRequestSent: { '@id': INTEROP.NeedBasedAccessRequestSent },
  RoleMembershipChanged: { '@id': INTEROP.RoleMembershipChanged },
  RoleDeleted: { '@id': INTEROP.RoleDeleted },
  RoleCreated: { '@id': INTEROP.RoleCreated },
  DelegatedGrantsUpdated: { '@id': INTEROP.DelegatedGrantsUpdated },
  AuthorizationRequested: { '@id': INTEROP.AuthorizationRequested },
  ShareRequested: { '@id': INTEROP.ShareRequested },
  ActivityCompleted: { '@id': INTEROP.ActivityCompleted },

  // interop — multi-value node references
  accessMode: iriTermDef(INTEROP, 'accessMode', { set: true }),
  creatorAccessMode: iriTermDef(INTEROP, 'creatorAccessMode', { set: true }),
  hasDataInstance: iriTermDef(INTEROP, 'hasDataInstance', { set: true }),

  // interop — reverse relationships (resolved by the framing algorithm)
  hasInheritingGrant: {
    '@reverse': INTEROP.inheritsFromGrant,
    '@type': '@id',
    '@container': '@set',
  },
  hasInheritingAuthorization: {
    '@reverse': INTEROP.inheritsFromAuthorization,
    '@type': '@id',
    '@container': '@set',
  },
  hasInheritingNeed: {
    '@reverse': INTEROP.inheritsFromNeed,
    '@type': '@id',
    '@container': '@set',
  },

  // ldp
  contains: iriTermDef(LDP, 'contains', { set: true }),

  // shapetrees — node references
  shape: iriTermDef(SHAPETREES, 'shape'),
  describesInstance: iriTermDef(SHAPETREES, 'describesInstance'),
  expectsType: iriTermDef(SHAPETREES, 'expectsType'),
  hasShapeTree: iriTermDef(SHAPETREES, 'hasShapeTree'),
  viaPredicate: iriTermDef(SHAPETREES, 'viaPredicate'),
  // node objects (references) — no IRI coercion
  references: { '@id': SHAPETREES.references, '@container': '@set' },
  // literals (xsd:language) on the description sets
  descriptionLanguages: { '@id': SHAPETREES.usesLanguage, '@container': '@set' },

  // skos — literals (the unified `label` term: `skos:prefLabel` everywhere,
  // the `prefLabel` key no longer exists — one term, no compaction ambiguity)
  label: { '@id': SKOS.prefLabel },
  definition: { '@id': SKOS.definition },
  note: { '@id': SKOS.note },

  // solid / oidc
  oidcIssuer: iriTermDef(SOLID, 'oidcIssuer'),
  clientName: { '@id': OIDC.client_name },
  logoUri: { '@id': OIDC.logo_uri },

  // nfo
  fileName: { '@id': NFO.fileName },
}
