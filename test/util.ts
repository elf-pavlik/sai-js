import { readFile } from 'node:fs/promises'
import {
  Postgres,
  RDF,
  getNotificationChannel,
  getOneMatchingQuad,
  parseTurtle,
} from '@janeirodigital/interop-utils'

const connectionString = 'postgres://temporal:temporal@postgresql:5432/auth'

export async function seedRegistry(): Promise<Response> {
  const dropRes = await dropRegistry()
  if (!dropRes.ok) throw new Error('dropping registry failed')
  const data = await readFile('../packages/css-storage-fixture/test/registry.trig')

  return fetch('http://sparql/store', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/trig',
    },
    body: data,
  })
}

export async function dropRegistry(): Promise<Response> {
  return fetch('http://sparql/store', {
    method: 'DELETE',
  })
}

export async function seedAuth(): Promise<void> {
  const data = JSON.parse(await readFile('../packages/css-storage-fixture/test/kv.json', 'utf8'))
  const pg = new Postgres(connectionString, 'key_value')
  await pg.ensureDatabase()
  await pg.importFromJson(data)
}

export async function dropAuth(): Promise<void> {
  const pg = new Postgres(connectionString, 'key_value')
  await pg.dropTable()
}

// TODO: deduplicate with notifications-manager from application package
export async function receivesNotification(
  authFetch: typeof fetch,
  resourceId: string,
  expectedType?: string
): Promise<boolean> {
  const headResponse = await authFetch(resourceId, { method: 'HEAD' })
  const linkHeader = headResponse.headers.get('link')
  if (!linkHeader) throw new Error('Link header is missing')
  const receiveFrom = getNotificationChannel(linkHeader)
  if (!receiveFrom) throw new Error(`Failed to discover notification chanel for: ${resourceId}`)

  const response = await authFetch(receiveFrom)
  if (!response.ok) {
    throw new Error(`failed connecting to notification stream: ${receiveFrom}, ${response.status}`)
  }
  if (!response.body) {
    throw new Error(`missing body of notification stream: ${receiveFrom}`)
  }
  const reader = response.body.getReader()
  const decoder = new TextDecoder()

  // discard initial notification
  await reader.read()
  try {
    while (response.body.locked) {
      const notification = await reader.read().then(({ value }) => decoder.decode(value))
      if (!notification) throw new Error('second chunk missing')
      const dataset = await parseTurtle(notification)
      const receivedType = getOneMatchingQuad(dataset, undefined, RDF.type)!.object.value
      if (!expectedType || receivedType === expectedType) return true
    }
  } finally {
    reader.releaseLock()
    await response.body.cancel()
  }
  return false
}
