import { readFile, writeFile } from 'node:fs/promises'

export async function seedQuadstore(sparqlEndpoint: string, filePath: string): Promise<void> {
  await dropQuadstore(sparqlEndpoint)
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
