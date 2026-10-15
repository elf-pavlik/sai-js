import {
  dataRegistryTemplate,
  registrySetTemplate,
  webIdTemplate,
} from '@janeirodigital/interop-data-model'
import { cssKv } from '@janeirodigital/interop-utils'
import postgres from 'postgres'

import { agentId, issuanceUrl } from '../util/uriTemplates.js'

/**
 * Dataset name for a pod — must match `packages/test-utils/src/fuseki.ts`
 * (`reg-<handle>` / `data-<pod>`). Kept inline so `components` does not depend
 * on the test-utils package.
 */
function datasetName(podUrl: string, kind: 'registry' | 'data'): string {
  const url = new URL(podUrl)
  const segment = url.pathname.split('/').filter(Boolean)[0] ?? url.hostname.split('.')[0]
  return `${kind === 'registry' ? 'reg' : 'data'}-${segment}`
}

export class AccountService {
  private sql: any

  constructor(
    private sparqlEndpoint: string,
    private postgresConnectionString: string,
    private tableName: string,
    private issuer: string,
    private idOrigin: string,
    private docOrigin: string,
    private dataOrigin: string,
    private regOrigin: string
  ) {
    this.sql = postgres(this.postgresConnectionString)
  }

  /** POST a TriG payload to a Fuseki Graph Store Protocol endpoint. */
  private async postTrig(endpoint: string, trig: string): Promise<void> {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/trig' },
      body: trig,
    })
    if (!response.ok) throw new Error(`failed POSTing dataset to ${endpoint}`)
  }

  /**
   * Best-effort dataset creation via the Fuseki admin API. Fixture pods are
   * pre-declared in `fuseki.config.ttl`; new signups need Fuseki Full with a
   * Shiro service account (`CSS_FUSEKI_ADMIN=user:password`).
   */
  private async ensureFusekiDataset(origin: string, name: string): Promise<void> {
    const admin = process.env.CSS_FUSEKI_ADMIN
    try {
      await fetch(`${origin}/$/datasets?dbType=tdb2&dbName=${encodeURIComponent(name)}`, {
        method: 'POST',
        headers: admin ? { Authorization: `Basic ${Buffer.from(admin).toString('base64')}` } : {},
      })
    } catch {
      // dataset already exists (config.ttl) or the admin API is unavailable —
      // the subsequent POST will surface a real failure
    }
  }

  async checkHandle(handle: string): Promise<boolean> {
    const webIdLinkKey = cssKv.webIdLinkByWebId(`https://${handle}.${this.idOrigin}`)
    const result = await this.sql`
      SELECT EXISTS(
        SELECT 1 FROM ${this.sql(this.tableName)}
        WHERE key = ${webIdLinkKey}
      )
    `
    return !result[0].exists
  }

  async bootstrapAccount(accountId: string, handle: string): Promise<string> {
    const webId = `https://${handle}.${this.idOrigin}`
    const docId = `https://${this.docOrigin}/${handle}`
    const uas = agentId(webId)
    const dataRegistry = `https://${handle}.${this.dataOrigin}/`
    const registrySet = `https://${this.regOrigin}/${handle}/`

    // stage 3 (docs/plans/fuseki-per-pod-sparql.md): one dataset per pod — the
    // registry set and the data registry each get their own endpoint; the WebID
    // profile stays in the shared dataset (the id service reads it there).
    const fusekiOrigin = new URL(this.sparqlEndpoint).origin
    const registryDataset = datasetName(registrySet, 'registry')
    const dataDataset = datasetName(dataRegistry, 'data')
    await this.ensureFusekiDataset(fusekiOrigin, registryDataset)
    await this.ensureFusekiDataset(fusekiOrigin, dataDataset)

    await this.postTrig(
      this.sparqlEndpoint,
      webIdTemplate({
        id: webId,
        document: docId,
        issuer: this.issuer,
        uas,
        issuance: issuanceUrl(webId),
      })
    )
    await this.postTrig(
      `${fusekiOrigin}/${registryDataset}/data`,
      registrySetTemplate({ id: registrySet, webId, uas, dataRegistry })
    )
    await this.postTrig(
      `${fusekiOrigin}/${dataDataset}/data`,
      dataRegistryTemplate({ id: dataRegistry })
    )
    const key = cssKv.accountData(accountId)
    const rows = await this
      .sql`SELECT value FROM ${this.sql(this.tableName)} WHERE key = ${String(key)}`
    if (rows.length === 0) return undefined
    const accountData = JSON.parse(rows[0].value)
    const ids = {
      pod: crypto.randomUUID(),
      owner: crypto.randomUUID(),
      webId: crypto.randomUUID(),
    }
    accountData['**pod**'] = {
      [ids.pod]: {
        baseUrl: dataRegistry,
        accountId,
        id: ids.pod,
        '**owner**': {
          [ids.owner]: {
            webId,
            visible: true,
            podId: ids.pod,
            id: ids.owner,
          },
        },
      },
    }
    accountData['**webIdLink**'] = {
      [ids.webId]: {
        webId,
        accountId,
        id: ids.webId,
      },
    }
    // Per-pod SPARQL endpoint registry (isolated-datasets-and-sparql.md 4a,
    // widened to per-pod), keyed by pod URL. Stage 2 of
    // docs/plans/fuseki-per-pod-sparql.md: both records point at the shared
    // dataset until the per-pod split (Stage 3) flips them to per-pod endpoints.
    const endpointIds = {
      registry: crypto.randomUUID(),
      data: crypto.randomUUID(),
    }
    accountData['**sparqlEndpoint**'] = {
      [endpointIds.registry]: {
        accountId,
        webId,
        podUrl: registrySet,
        endpoint: `${fusekiOrigin}/${registryDataset}/sparql`,
        id: endpointIds.registry,
      },
      [endpointIds.data]: {
        accountId,
        webId,
        podUrl: dataRegistry,
        endpoint: `${fusekiOrigin}/${dataDataset}/sparql`,
        id: endpointIds.data,
      },
    }
    // TODO: separate update from instert
    const record = {
      [key]: accountData,
      [cssKv.webIdLink(ids.webId)]: [accountId],
      [cssKv.webIdLinkByWebId(webId)]: [accountId],
      [cssKv.owner(ids.owner)]: [accountId],
      [cssKv.pod(ids.pod)]: [accountId],
      [cssKv.podByBaseUrl(dataRegistry)]: [accountId],
      [`accounts/index/sparqlEndpoint/${endpointIds.registry}`]: [accountId],
      [`accounts/index/sparqlEndpoint/${endpointIds.data}`]: [accountId],
      [`accounts/index/sparqlEndpoint/webId/${encodeURIComponent(webId)}`]: [accountId],
      [`accounts/index/sparqlEndpoint/podUrl/${encodeURIComponent(registrySet)}`]: [accountId],
      [`accounts/index/sparqlEndpoint/podUrl/${encodeURIComponent(dataRegistry)}`]: [accountId],
    }
    const entries = Object.entries(record).map(([entryKey, value]) => ({
      key: entryKey,
      value: JSON.stringify(value),
    }))
    await this.sql`
      INSERT INTO ${this.sql(this.tableName)} ${this.sql(entries as any)}
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
    `
    return webId
  }
}
