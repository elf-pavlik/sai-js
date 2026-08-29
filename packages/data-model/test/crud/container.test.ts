import { randomUUID } from 'node:crypto'
import { fetch } from '@janeirodigital/interop-test-utils'
import { insertPatch } from '@janeirodigital/interop-utils'
import { DataFactory, Store } from 'n3'
import { beforeEach, describe, test, vi } from 'vitest'
import type { DataModelDependencies } from '../../src'
import { applyPatch, replaceStatement } from '../../src/crud/container'
import { expect } from '../expect'

const webId = 'https://alice.example/#id'
const agentId = 'https://jarvis.alice.example/#agent'
const mockedFetch = vi.fn(fetch)
// @ts-ignore
const deps: DataModelDependencies = { fetch: mockedFetch, randomUUID }

beforeEach(() => {
  mockedFetch.mockClear()
})

const iri = 'https://work.alice.example/something/'
const predicate = 'https://vocab.example/thinks'

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

    await replaceStatement(iri, deps.fetch, priorQuad, quad)
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

    await expect(applyPatch(iri, deps.fetch, sparqlUpdate, `${iri}.meta`)).rejects.toThrow(
      'failed to patch'
    )
  })
})
