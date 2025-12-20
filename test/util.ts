import { readFile } from 'node:fs/promises'

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
