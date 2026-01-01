import { readFile, writeFile } from 'node:fs/promises'
import { Postgres } from './postgres'

export async function seedQuadstore(sparqlEndpoint: string, filePath: string): Promise<void> {
  const data = await readFile(filePath, 'utf8')
  const response = await fetch(sparqlEndpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/trig',
    },
    body: data,
  })
  if (!response.ok) throw new Error('seeding quadstore failed')
}

export async function dumpQuadstore(sparqlEndpoint: string, filePath: string): Promise<void> {
  const response = await fetch(sparqlEndpoint, {
    headers: {
      Accept: 'application/trig',
    },
  })
  await writeFile(filePath, await response.text())
}

export async function dropQuadstore(sparqlEndpoint: string): Promise<void> {
  const response = await fetch(sparqlEndpoint, {
    method: 'DELETE',
  })
  if (!response.ok) throw new Error('dropping quadstore failed')
}

export async function seedKeyValue(connectionString: string, filePath: string): Promise<void> {
  const data = JSON.parse(await readFile(filePath, 'utf8'))
  const pg = new Postgres(connectionString, 'key_value')
  await pg.ensureDatabase()
  await pg.importFromJson(data)
}

export async function dropKeyValue(connectionString: string): Promise<void> {
  const pg = new Postgres(connectionString, 'key_value')
  await pg.dropTable()
}

export async function dumpKeyValue(connectionString: string, filePath: string): Promise<void> {
  const pg = new Postgres(connectionString, 'key_value')
  const data = await pg.exportToJson()
  await writeFile(filePath, JSON.stringify(data, null, 2))
}
