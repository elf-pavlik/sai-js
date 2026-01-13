import {
  dataRegistryTemplate,
  registrySetTemplate,
  webIdTemplate,
} from '@janeirodigital/interop-data-model'
import postgres from 'postgres'
import { agentId } from '../util/uriTemplates.js'
const sql = postgres(process.env.CSS_POSTGRES_CONNECTION_STRING)
const tableName = 'key_value'

const sparqlEndpoint = process.env.CSS_SPARQL_ENDPOINT

export async function checkHandle(handle: string): Promise<boolean> {
  const webIdLinkKey = `accounts/index/webIdLink/webId/https%3A%2F%2F${handle}.id.docker`
  const result = await sql`
    SELECT EXISTS(
      SELECT 1 FROM ${sql(tableName)}
      WHERE key = ${webIdLinkKey}
    )
  `
  return !result[0].exists
}

// TODO: use URI templates
export async function bootstrapAccount(accountId: string, handle: string): Promise<string> {
  const issuer = process.env.CSS_BASE_URL
  const webId = `https://${handle}.id.docker`
  const docId = `https://id.docker/${handle}`
  const uas = agentId(webId)
  const dataRegistry = `https://${handle}.data.docker/`
  const registrySet = `https://reg.docker/${handle}/`
  // TODO: add ACR
  const trigDataset = `
    ${webIdTemplate({ id: webId, document: docId, issuer, uas, registry: registrySet })}
    ${dataRegistryTemplate({ id: dataRegistry })}
    ${registrySetTemplate({ id: registrySet, webId, uas, dataRegistry })}
  `
  const response = await fetch(sparqlEndpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/trig',
    },
    body: trigDataset,
  })
  if (!response.ok) throw new Error('failed POSTing dataset to the quadstore')
  const key = `accounts/data/${accountId}`
  const rows = await sql`SELECT value FROM ${sql(tableName)} WHERE key = ${String(key)}`
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
  // TODO: separate update from instert
  const record = {
    [key]: accountData,
    [`accounts/index/webIdLink/${ids.webId}`]: [accountId],
    [`accounts/index/webIdLink/webId/${encodeURIComponent(webId)}`]: [accountId],
    [`accounts/index/owner/${ids.owner}`]: [accountId],
    [`accounts/index/pod/${ids.pod}`]: [accountId],
    [`accounts/index/pod/baseUrl/${encodeURIComponent(dataRegistry)}`]: [accountId],
  }
  const entries = Object.entries(record).map(([key, value]) => ({
    key,
    value: JSON.stringify(value),
  }))
  await sql`
    INSERT INTO ${sql(tableName)} ${sql(entries as any)}
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
  `
  return webId
}
