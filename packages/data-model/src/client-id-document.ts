import {
  INTEROP,
  type JsonLdContext,
  OIDC,
  frameNode,
  selectNode,
} from '@janeirodigital/interop-utils'
import { dataModelContext } from './context'

export type ClientIdDocumentId = {
  id: string
  type: string[]
}

export type ClientIdDocumentData = ClientIdDocumentId & {
  callbackEndpoint?: string
  hasAccessNeedGroup?: string
  clientName?: string
  logoUri?: string
}

const clientIdContext: JsonLdContext = {
  ...dataModelContext,
  callbackEndpoint: {
    '@id': INTEROP.hasAuthorizationCallbackEndpoint,
    '@type': '@id',
  },
  hasAccessNeedGroup: { '@id': INTEROP.hasAccessNeedGroup, '@type': '@id' },
  logoUri: { '@id': OIDC.logo_uri, '@type': '@id' },
}

const CLIENT_ID_DOCUMENT_TERMS = [
  'callbackEndpoint',
  'hasAccessNeedGroup',
  'clientName',
  'logoUri',
] as const

export async function fromJsonLd(doc: unknown, id: string): Promise<ClientIdDocumentData> {
  return selectNode(
    await frameNode(doc, dataModelContext, id),
    CLIENT_ID_DOCUMENT_TERMS
  ) as unknown as ClientIdDocumentData
}
