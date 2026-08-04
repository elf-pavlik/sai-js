import type { DatasetCore, Quad } from '@rdfjs/types'
import * as jsonldNs from 'jsonld'
import { Store } from 'n3'

// CJS/ESM interop: jsonld is a CJS package; in the ESM bundle the namespace
// has the full exports only on .default, while named exports like `toRDF` are
// hoisted.  Grab the full object so that `documentLoaders` is available.
const jsonld = (jsonldNs as any).default ?? jsonldNs

// Local type for the document loader result compatible with jsonld's RemoteDocument
interface RemoteDocument {
  contextUrl?: string | null
  document: unknown
  documentUrl: string
}

/**
 * Wrapper around jsonld.toRDF to parse JSON-LD text into an N3 Store.
 * @param text Text to parse (JSON-LD)
 * @param source Base IRI
 */
export const parseJsonld = async (text: string, source = ''): Promise<DatasetCore> => {
  const doc = JSON.parse(text)
  const dataset = await jsonld.toRDF(doc, {
    base: source || undefined,
    documentLoader: localDocumentLoader as any,
  })
  const store = new Store()
  for (const quad of dataset as unknown as Iterable<Quad>) {
    store.add(quad)
  }
  return store
}

export async function localDocumentLoader(
  url: string
): Promise<RemoteDocument> {
  if (url in localContexts) {
    return {
      contextUrl: null,
      document: localContexts[url],
      documentUrl: url,
    }
  }
  const response = await fetch(url)
  const document = await response.json()
  return {
    contextUrl: null,
    document,
    documentUrl: url,
  }
}

type LocalContext = Record<string, unknown> & { '@context'?: unknown }

const localContexts: Record<string, LocalContext> = {
  'https://www.w3.org/ns/solid/oidc-context.jsonld': {
    '@context': {
      '@version': 1.1,
      '@protected': true,
      oidc: 'http://www.w3.org/ns/solid/oidc#',
      xsd: 'http://www.w3.org/2001/XMLSchema#',
      client_id: {
        '@id': '@id',
        '@type': '@id',
      },
      client_uri: {
        '@id': 'oidc:client_uri',
        '@type': '@id',
      },
      logo_uri: {
        '@id': 'oidc:logo_uri',
        '@type': '@id',
      },
      policy_uri: {
        '@id': 'oidc:policy_uri',
        '@type': '@id',
      },
      tos_uri: {
        '@id': 'oidc:tos_uri',
        '@type': '@id',
      },
      redirect_uris: {
        '@id': 'oidc:redirect_uris',
        '@type': '@id',
        '@container': ['@id', '@set'],
      },
      require_auth_time: {
        '@id': 'oidc:require_auth_time',
        '@type': 'xsd:boolean',
      },
      default_max_age: {
        '@id': 'oidc:default_max_age',
        '@type': 'xsd:integer',
      },
      application_type: {
        '@id': 'oidc:application_type',
      },
      client_name: {
        '@id': 'oidc:client_name',
      },
      contacts: {
        '@id': 'oidc:contacts',
      },
      grant_types: {
        '@id': 'oidc:grant_types',
      },
      response_types: {
        '@id': 'oidc:response_types',
      },
      scope: {
        '@id': 'oidc:scope',
      },
      token_endpoint_auth_method: {
        '@id': 'oidc:token_endpoint_auth_method',
      },
    },
  },
  'https://www.w3.org/ns/solid/notifications-context/v1': {
    '@context': {
      '@version': 1.1,
      '@protected': true,
      id: '@id',
      type: '@type',
      notify: 'http://www.w3.org/ns/solid/notifications#',
      xsd: 'http://www.w3.org/2001/XMLSchema#',
      EventSourceChannel2023: 'notify:EventSourceChannel2023',
      LDNChannel2023: 'notify:LDNChannel2023',
      StreamingHTTPChannel2023: 'notify:StreamingHTTPChannel2023',
      WebhookChannel2023: 'notify:WebhookChannel2023',
      WebSocketChannel2023: 'notify:WebSocketChannel2023',
      accept: 'notify:accept',
      channel: {
        '@id': 'notify:channel',
        '@type': '@id',
      },
      channelType: {
        '@id': 'notify:channelType',
        '@type': '@vocab',
      },
      endAt: {
        '@id': 'notify:endAt',
        '@type': 'xsd:dateTime',
      },
      feature: {
        '@id': 'notify:feature',
        '@type': '@vocab',
      },
      rate: {
        '@id': 'notify:rate',
        '@type': 'xsd:duration',
      },
      receiveFrom: {
        '@id': 'notify:receiveFrom',
        '@type': '@id',
      },
      sender: {
        '@id': 'notify:sender',
        '@type': '@id',
      },
      sendTo: {
        '@id': 'notify:sendTo',
        '@type': '@id',
      },
      state: 'notify:state',
      startAt: {
        '@id': 'notify:startAt',
        '@type': 'xsd:dateTime',
      },
      subscription: {
        '@id': 'notify:subscription',
        '@type': '@id',
      },
      topic: {
        '@id': 'notify:topic',
        '@type': '@id',
      },
    },
  },
}
