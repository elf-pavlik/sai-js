import { DataFactory } from 'n3'
import { expect, test } from 'vitest'
import { parseJsonld } from '../src'

const snippet = `
{
  "@context": {
    "ical": "http://www.w3.org/2002/12/cal/ical#",
    "xsd": "http://www.w3.org/2001/XMLSchema#",
    "ical:dtstart": {
      "@type": "xsd:dateTime"
    }
  },
  "ical:summary": "Lady Gaga Concert",
  "ical:location": "New Orleans Arena, New Orleans, Louisiana, USA",
  "ical:dtstart": "2011-04-09T20:00:00Z"
}
`

test('should parse json-ld', async () => {
  const source = 'https://some.example/'
  const dataset = await parseJsonld(snippet, source)
  expect(dataset.size).toBe(3)
})

test('uses DefaultGraph is none is provided', async () => {
  const dataset = await parseJsonld(snippet)
  expect(dataset.size).toBeGreaterThan(1)
  for (const quad of dataset) {
    expect(quad.graph.termType).toEqual('DefaultGraph')
  }
})

test('parses a CID document with the embedded cid context', async () => {
  const cid = JSON.stringify({
    '@context': ['https://www.w3.org/ns/cid/v1'],
    id: 'https://id.example/alice',
    service: [
      {
        type: 'https://www.w3.org/ns/lws#OpenIdProvider',
        serviceEndpoint: 'https://auth.example/',
      },
    ],
  })
  const dataset = await parseJsonld(cid)
  const { namedNode, quad } = DataFactory
  const serviceTriples = [...dataset].filter(
    (q) => q.predicate.value === 'https://www.w3.org/ns/did#service'
  )
  expect(serviceTriples).toHaveLength(1)
  const serviceNode = serviceTriples[0].object
  expect([...dataset]).toContainEqual(
    quad(
      serviceNode,
      namedNode('http://www.w3.org/1999/02/22-rdf-syntax-ns#type'),
      namedNode('https://www.w3.org/ns/lws#OpenIdProvider')
    )
  )
  expect([...dataset]).toContainEqual(
    quad(
      serviceNode,
      namedNode('https://www.w3.org/ns/did#serviceEndpoint'),
      namedNode('https://auth.example/')
    )
  )
})
