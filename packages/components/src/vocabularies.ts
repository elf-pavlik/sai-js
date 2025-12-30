import { createVocabulary } from 'rdf-vocabulary'

export const INTEROP = createVocabulary(
  'http://www.w3.org/ns/solid/interop#',
  'registeredAgent',
  'hasStorage',
  'grantee',
  'grantedBy',
  'hasStorage',
  'hasDataRegistration',
  'hasDataInstance',
  'accessMode',
  'scopeOfGrant',
  'AllFromRegistry',
  'SelectedFromRegistry'
)
export const ACL = createVocabulary(
  'http://www.w3.org/ns/auth/acl#',
  'Create',
  'Read',
  'Update',
  'Delete'
)
