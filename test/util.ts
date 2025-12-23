import { readFile } from 'node:fs/promises'
import { Postgres } from '@janeirodigital/interop-utils'

export async function seedRegistry(): Promise<Response> {
  const data = await readFile('../packages/css-storage-fixture/test/registry.trig')

  return await fetch('http://sparql/store', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/trig',
    },
    body: data,
  })
}

export async function seedAuth(): Promise<void> {
  const connectionString = 'postgres://temporal:temporal@postgresql:5432/auth'
  const data = JSON.parse(await readFile('../packages/css-storage-fixture/test/kv.json', 'utf8'))
  const pg = new Postgres(connectionString, 'key_value')
  await pg.ensureDatabase()
  await pg.importFromJson(data)
}
