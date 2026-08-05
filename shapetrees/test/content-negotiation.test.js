import { describe, expect, it } from 'vitest' // available via monorepo root node_modules
import { negotiate } from '../functions/[collection]/[name].js'

// Helper: build a minimal Request-like object that the `negotiate` helper
// uses (it only reads `request.headers.get('Accept')`).
const req = (accept) => ({ headers: { get: (h) => (h === 'Accept' ? accept : null) } })

describe('content negotiation', () => {
  describe('trees collection', () => {
    it('defaults to JSON-LD when no Accept header is provided', () => {
      expect(negotiate('trees', 'Task', req(null))).toMatchObject({
        ext: 'jsonld',
        type: 'application/ld+json',
        baseName: 'Task',
      })
    })

    it('defaults to JSON-LD for a */* wildcard', () => {
      expect(negotiate('trees', 'Task', req('*/*'))).toMatchObject({
        ext: 'jsonld',
        type: 'application/ld+json',
      })
    })

    it('serves Turtle when text/turtle is requested', () => {
      expect(negotiate('trees', 'Task', req('text/turtle'))).toMatchObject({
        ext: 'ttl',
        type: 'text/turtle',
        fromAccept: true,
      })
    })

    it('serves Turtle for application/n-triples (alternate Turtle type)', () => {
      expect(negotiate('trees', 'Task', req('application/n-triples'))).toMatchObject({
        ext: 'ttl',
        type: 'text/turtle',
      })
    })

    it('serves JSON-LD when application/ld+json is requested', () => {
      expect(negotiate('trees', 'Task', req('application/ld+json'))).toMatchObject({
        ext: 'jsonld',
        type: 'application/ld+json',
        fromAccept: true,
      })
    })

    it('treats application/json as JSON-LD', () => {
      expect(negotiate('trees', 'Task', req('application/json'))).toMatchObject({
        ext: 'jsonld',
        type: 'application/ld+json',
      })
    })

    it('falls back to the default (JSON-LD) for an unmatched Accept', () => {
      expect(negotiate('trees', 'Task', req('text/html'))).toMatchObject({
        ext: 'jsonld',
        type: 'application/ld+json',
      })
    })

    it('honors q-values: ld+json preferred over turtle', () => {
      const accept = 'application/ld+json;q=1.0,text/turtle;q=0.5'
      expect(negotiate('trees', 'Task', req(accept))).toMatchObject({
        ext: 'jsonld',
        type: 'application/ld+json',
      })
    })

    it('honors q-values: turtle preferred over ld+json', () => {
      const accept = 'text/turtle;q=1.0,application/ld+json;q=0.5'
      expect(negotiate('trees', 'Task', req(accept))).toMatchObject({
        ext: 'ttl',
        type: 'text/turtle',
      })
    })

    it('at equal q, prefers the first listed format (JSON-LD)', () => {
      const accept = 'application/ld+json;q=0.5,text/turtle;q=0.5'
      expect(negotiate('trees', 'Task', req(accept))).toMatchObject({
        ext: 'jsonld',
      })
    })
  })

  describe('explicit file suffix overrides Accept', () => {
    it('.jsonld suffix serves JSON-LD even when Accept is turtle', () => {
      const chosen = negotiate('trees', 'Task.jsonld', req('text/turtle'))
      expect(chosen).toMatchObject({
        ext: 'jsonld',
        type: 'application/ld+json',
        baseName: 'Task',
      })
      // explicit suffix overrides Accept: it is NOT marked as negotiated-from-Accept
      expect(chosen).not.toHaveProperty('fromAccept')
    })

    it('.ttl suffix serves Turtle even when Accept is ld+json', () => {
      expect(negotiate('trees', 'Task.ttl', req('application/ld+json'))).toMatchObject({
        ext: 'ttl',
        type: 'text/turtle',
        baseName: 'Task',
      })
    })
  })

  describe('shapes collection (ShEx only, not RDF)', () => {
    it('serves ShEx regardless of Accept', () => {
      expect(negotiate('shapes', 'Task', req('application/ld+json'))).toMatchObject({
        ext: 'shex',
        type: 'text/shex',
      })
    })

    it('honors an explicit .shex suffix', () => {
      expect(negotiate('shapes', 'Task.shex', req('text/turtle'))).toMatchObject({
        ext: 'shex',
        type: 'text/shex',
        baseName: 'Task',
      })
    })
  })

  describe('unknown', () => {
    it('returns null for an unknown collection (caller responds 404)', () => {
      expect(negotiate('bogus', 'x', req('text/turtle'))).toBeNull()
    })

    it('still attempts a resource name that does not exist as a file', () => {
      // negotiate() only picks a representation; it does not read the file.
      expect(negotiate('trees', 'Unknown', req('text/turtle'))).toMatchObject({
        ext: 'ttl',
        type: 'text/turtle',
      })
    })
  })
})
