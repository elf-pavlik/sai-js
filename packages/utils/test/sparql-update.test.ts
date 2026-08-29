import { DataFactory, Store } from 'n3'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import {
  type WhatwgFetch,
  applyPatch,
  deletePatch,
  insertPatch,
  parseTurtle,
  replaceStatement,
  serializeTurtle,
} from '../src'

const snippet = `
  @prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
  @prefix interop: <http://www.w3.org/ns/solid/interop#> .
  @prefix solidtrees: <https://solidshapes.example/trees/> .
  @prefix acme: <https://acme.example/> .
  acme:4d594c61-7cff-484a-a1d2-1f353ee4e1e7
    a interop:DataRegistration ;
    interop:registeredBy <https://garry.example/#id> ;
    interop:registeredWith <https://solidmin.example/#app> ;
    interop:registeredAt "2020-08-23T21:12:27.000Z"^^xsd:dateTime ;
    interop:registeredShapeTree solidtrees:Project .
`

// Local stub: answers HEAD/PATCH with ok and a describedby Link header —
// keeps utils free of a dependency on interop-test-utils (which depends on
// utils, so a devDep here would create a workspace dependency cycle).
const fetch: WhatwgFetch = async () =>
  ({
    ok: true,
    headers: {
      get: (name: string) =>
        name === 'Link'
          ? '<http://just.en.example/description-resource>; rel="describedby"'
          : undefined,
    },
    text: async () => '',
    status: 200,
  }) as unknown as Response

const mockedFetch = vi.fn(fetch)

beforeEach(() => {
  mockedFetch.mockClear()
})

const iri = 'https://work.alice.example/something/'
const predicate = 'https://vocab.example/thinks'

test('insertPatch', async () => {
  const dataset = await parseTurtle(snippet)
  const patch = await insertPatch(dataset)
  const expected = `INSERT DATA { ${await serializeTurtle(dataset)} }`
  expect(patch).toBe(expected)
})

test('deletePatch', async () => {
  const dataset = await parseTurtle(snippet)
  const patch = await deletePatch(dataset)
  const expected = `DELETE DATA { ${await serializeTurtle(dataset)} }`
  expect(patch).toBe(expected)
})

describe('replaceStatement', () => {
  test('calls correct patch functions', async () => {
    const priorQuad = DataFactory.quad(
      DataFactory.namedNode(iri),
      DataFactory.namedNode(predicate),
      DataFactory.namedNode(`${iri}beep`)
    )

    const quad = DataFactory.quad(
      DataFactory.namedNode(iri),
      DataFactory.namedNode(predicate),
      DataFactory.namedNode(`${iri}boop`)
    )

    await replaceStatement(iri, mockedFetch as never, priorQuad, quad)
    expect(mockedFetch).toBeCalledWith(
      expect.any(String),
      expect.objectContaining({ body: expect.stringContaining('DELETE DATA') })
    )
    expect(mockedFetch).toBeCalledWith(
      expect.any(String),
      expect.objectContaining({ body: expect.stringContaining('INSERT DATA') })
    )
  })
})

describe('applyPatch', () => {
  test('throws if failed to patch', async () => {
    const quad = DataFactory.quad(
      DataFactory.namedNode(iri),
      DataFactory.namedNode(predicate),
      DataFactory.namedNode(`${iri}boop`)
    )
    const sparqlUpdate = await insertPatch(new Store([quad]))
    mockedFetch.mockResolvedValueOnce({ ok: false } as unknown as Response)

    await expect(
      applyPatch(iri, mockedFetch as never, sparqlUpdate, `${iri}.meta`)
    ).rejects.toThrow('failed to patch')
  })
})
