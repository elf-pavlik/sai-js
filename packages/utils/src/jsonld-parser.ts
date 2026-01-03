import type { DatasetCore } from '@rdfjs/types'
import type { IDocumentLoader, IJsonLdContext } from 'jsonld-context-parser'
import { FetchDocumentLoader } from 'jsonld-context-parser'
import { JsonLdParser } from 'jsonld-streaming-parser'
import { Store } from 'n3'

/**
 * Wrapper around streaming-jsonld-parser to convert from callback style to Promise.
 * @param text Text to parse (JSON-LD)
 * @param source
 */

export const parseJsonld = async (text: string, source = ''): Promise<DatasetCore> => {
  const store = new Store()
  return new Promise((resolve, reject) => {
    const parserOptions: { baseIRI?: string; documentLoader: IDocumentLoader } = {
      documentLoader: new LocalDocumentLoader(localContexts),
    }
    if (source) {
      parserOptions.baseIRI = source
    }
    const parser = new JsonLdParser(parserOptions)
    parser.on('data', (quads) => store.add(quads))
    parser.on('error', (error) => reject(error))
    parser.on('end', () => resolve(store))
    parser.write(text)
    parser.end()
  })
}

class LocalDocumentLoader extends FetchDocumentLoader {
  public constructor(private readonly contexts: Record<string, IJsonLdContext>) {
    super(fetch)
  }

  public async load(url: string): Promise<IJsonLdContext> {
    if (url in this.contexts) {
      return this.contexts[url]
    }
    super.load(url)
  }
}

const localContexts = {
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
