import { describe, expect, test, vi } from 'vitest'
import { type WhatwgFetch, documentValues, fetchJsonLd, findNodeIdByType } from '../src'

function mockFetch(response: Partial<Response> & { ok: boolean }): WhatwgFetch {
  return vi.fn(async () => response) as unknown as WhatwgFetch
}

describe('fetchJsonLd', () => {
  test('requests application/ld+json and returns the parsed document', async () => {
    const doc = { '@id': 'https://example.example/resource' }
    const fetch = vi.fn(async () => ({ ok: true, json: async () => doc })) as unknown as WhatwgFetch
    const result = await fetchJsonLd('https://example.example/resource', fetch)
    expect(result).toEqual(doc)
    expect(fetch).toHaveBeenCalledWith('https://example.example/resource', {
      headers: { Accept: 'application/ld+json' },
    })
  })

  test('throws when the request fails', async () => {
    const fetch = mockFetch({ ok: false, status: 404 })
    await expect(fetchJsonLd('https://example.example/missing', fetch)).rejects.toThrow(
      'failed to fetch https://example.example/missing: 404'
    )
  })
})

describe('documentValues', () => {
  const predicate = 'https://example.example/vocab#knows'
  const doc = [
    {
      '@id': 'https://example.example/alice',
      [predicate]: [{ '@id': 'https://example.example/bob' }],
    },
    {
      '@id': 'https://example.example/other',
      [predicate]: [{ '@value': 'literal value' }],
    },
  ]

  test('collects node references and literals across all nodes', async () => {
    const values = await documentValues(doc, 'https://example.example/alice', predicate)
    expect(values).toEqual(['https://example.example/bob', 'literal value'])
  })

  test('returns an empty array when the predicate is absent', async () => {
    const values = await documentValues(
      doc,
      'https://example.example/alice',
      'https://absent.example/pred'
    )
    expect(values).toEqual([])
  })
})

describe('findNodeIdByType', () => {
  const typeIri = 'http://www.w3.org/ns/pim/space#Storage'
  const doc = [
    {
      '@id': 'https://example.example/storage',
      '@type': [typeIri],
    },
  ]

  test('returns the @id of the node with the given type', async () => {
    const id = await findNodeIdByType(doc, typeIri, 'https://example.example/description')
    expect(id).toBe('https://example.example/storage')
  })

  test('throws when no node has the given type', async () => {
    await expect(findNodeIdByType(doc, 'https://absent.example/type')).rejects.toThrow(
      'no node of type https://absent.example/type in document'
    )
  })
})
