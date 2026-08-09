import { randomUUID } from 'node:crypto'
import { fetch } from '@janeirodigital/interop-test-utils'
import {
  INTEROP,
  XSD,
  getAllMatchingQuads,
  getOneMatchingQuad,
  insertPatch,
} from '@janeirodigital/interop-utils'
import { DataFactory, Store } from 'n3'
import { beforeEach, describe, test, vi } from 'vitest'
import { AuthorizationAgentFactory } from '../../src'
import { applyPatch, replaceStatement, setTimestampsAndAgents } from '../../src/crud/container'
import { expect } from '../expect'

const webId = 'https://alice.example/#id'
const agentId = 'https://jarvis.alice.example/#agent'
const mockedFetch = vi.fn(fetch)
// @ts-ignore
const factory = new AuthorizationAgentFactory({ fetch: mockedFetch, randomUUID })

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

    await replaceStatement(iri, factory, priorQuad, quad)
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

    await expect(applyPatch(iri, factory, sparqlUpdate, `${iri}.meta`)).rejects.toThrow(
      'failed to patch'
    )
  })
})

describe('setTimestampsAndAgents', () => {
  const timestampIri = 'https://work.alice.example/something/'

  test('when includeRegistered is true sets registeredBy and registeredWith', () => {
    const dataset = new Store()
    setTimestampsAndAgents(dataset, timestampIri, { agent: webId, client: agentId }, true)
    expect(dataset).toBeRdfDatasetContaining(
      DataFactory.quad(
        DataFactory.namedNode(timestampIri),
        INTEROP.terms.registeredBy,
        DataFactory.literal(webId, XSD.terms.string)
      ),
      DataFactory.quad(
        DataFactory.namedNode(timestampIri),
        INTEROP.terms.registeredWith,
        DataFactory.literal(agentId, XSD.terms.string)
      )
    )
  })

  test('when includeRegistered is true sets registeredAt and updatedAt as dateTime literals', () => {
    const dataset = new Store()
    setTimestampsAndAgents(dataset, timestampIri, { agent: webId, client: agentId }, true)
    for (const predicate of [INTEROP.terms.registeredAt, INTEROP.terms.updatedAt]) {
      const quad = getOneMatchingQuad(dataset, DataFactory.namedNode(timestampIri), predicate)
      expect(quad).toBeDefined()
      expect(quad!.object.termType).toBe('Literal')
      expect(quad!.object.datatype.value).toBe(XSD.dateTime)
    }
  })

  test('when includeRegistered is false sets only updatedAt', () => {
    const dataset = new Store()
    setTimestampsAndAgents(dataset, timestampIri, { agent: webId, client: agentId }, false)
    expect(
      getOneMatchingQuad(dataset, DataFactory.namedNode(timestampIri), INTEROP.terms.registeredBy)
    ).toBeUndefined()
    expect(
      getOneMatchingQuad(dataset, DataFactory.namedNode(timestampIri), INTEROP.terms.registeredAt)
    ).toBeUndefined()
    expect(
      getOneMatchingQuad(dataset, DataFactory.namedNode(timestampIri), INTEROP.terms.updatedAt)
    ).toBeDefined()
  })

  test('replaces existing values', () => {
    const dataset = new Store()
    setTimestampsAndAgents(dataset, timestampIri, { agent: webId, client: agentId }, true)
    setTimestampsAndAgents(dataset, timestampIri, { agent: webId, client: agentId }, true)
    expect(
      getAllMatchingQuads(dataset, DataFactory.namedNode(timestampIri), INTEROP.terms.registeredBy)
    ).toHaveLength(1)
  })
})
