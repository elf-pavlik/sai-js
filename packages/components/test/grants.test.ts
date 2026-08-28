import type { AuthorizationAgent } from '@janeirodigital/interop-authorization-agent'
import { INTEROP } from '@janeirodigital/interop-utils'
import { DataFactory } from 'n3'
import { describe, expect, test, vi } from 'vitest'

// ──────────────────────────
// Mocks
// ──────────────────────────

/** The activity gets its session via buildSessionManager — stub it. */
const sessionMock = vi.hoisted(() => {
  let session: unknown
  return {
    setSession: (s: unknown) => {
      session = s
    },
    getSession: () => session,
  }
})

vi.mock('../src/builders/sessionManager.js', () => ({
  buildSessionManager: () => ({ getSession: async () => sessionMock.getSession() }),
}))

/** The session reads its own registry via the internal SPARQL endpoint. */
const sparqlMock = vi.hoisted(() => {
  const handlers: {
    bindings?: (query: string) => Array<Record<string, { termType: string; value: string }>>
    triples?: (query: string) => unknown[]
  } = {}
  return { handlers }
})

vi.mock('fetch-sparql-endpoint', () => ({
  SparqlEndpointFetcher: class {
    async fetchBindings(_endpoint: string, query: string) {
      if (!sparqlMock.handlers.bindings) throw new Error('mock: no bindings handler')
      return sparqlMock.handlers.bindings(query)
    }
    async fetchTriples(_endpoint: string, query: string) {
      if (!sparqlMock.handlers.triples) throw new Error('mock: no triples handler')
      return sparqlMock.handlers.triples(query)
    }
  },
}))

/**
 * `typeGrantee` resolves grantees via the data-model registries — stub them
 * so grantees type as social agents without HTTP (everything else,
 * including the `DataAuthorization.fromJsonLd` framing, stays real).
 */
vi.mock('@janeirodigital/interop-data-model', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@janeirodigital/interop-data-model')>()
  return {
    ...mod,
    AgentRegistry: {
      ...mod.AgentRegistry,
      findRegistration: vi.fn(async (_data: unknown, _factory: unknown, iri: string) => ({
        id: iri,
        type: ['http://www.w3.org/ns/solid/interop#SocialAgentRegistration'],
        registeredAgent: iri,
      })),
    },
    RoleRegistry: {
      ...mod.RoleRegistry,
      containedIncludes: vi.fn(async () => false),
    },
  }
})

import { findAffectedGrantees, findRoleUsage } from '../src/temporal/activities/grants.js'

// ──────────────────────────
// Fixtures
// ──────────────────────────

const ALICE = 'https://alice.example/#id'
const ROLE_ID = 'https://auth.alice.example/role/admin'
const AUTHZ_REGISTRY = 'https://auth.alice.example/authorization/'
const AUTHZ_GRANTEE = 'https://auth.alice.example/authz-grantee'
const AUTHZ_ADMIN = 'https://auth.alice.example/admin-authz'
const RDF_TYPE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type'

const authzGraph = (
  iri: string,
  type: string,
  grantee: string,
  dataOwner: string,
  scope = INTEROP.All
) => [
  DataFactory.quad(
    DataFactory.namedNode(iri),
    DataFactory.namedNode(RDF_TYPE),
    DataFactory.namedNode(type)
  ),
  DataFactory.quad(
    DataFactory.namedNode(iri),
    DataFactory.namedNode(INTEROP.grantee),
    DataFactory.namedNode(grantee)
  ),
  DataFactory.quad(
    DataFactory.namedNode(iri),
    DataFactory.namedNode(INTEROP.grantedBy),
    DataFactory.namedNode(ALICE)
  ),
  DataFactory.quad(
    DataFactory.namedNode(iri),
    DataFactory.namedNode(INTEROP.dataOwner),
    DataFactory.namedNode(dataOwner)
  ),
  DataFactory.quad(
    DataFactory.namedNode(iri),
    DataFactory.namedNode(INTEROP.scopeOfAuthorization),
    DataFactory.namedNode(scope)
  ),
]

function fakeSession(): AuthorizationAgent {
  return {
    sparqlEndpoint: 'http://example.test/sparql',
    registrySet: { hasAuthorizationRegistry: { id: AUTHZ_REGISTRY } },
  } as unknown as AuthorizationAgent
}

const rolePayload = () => ({
  webId: { id: ALICE, type: [INTEROP.SocialAgent] } as never,
  roleId: { id: ROLE_ID, type: [INTEROP.Role] } as never,
})

// ──────────────────────────
// findRoleUsage — registry-plane sweep (docs/sparql.md, candidate 2)
// ──────────────────────────

describe('findRoleUsage — authorizations sweep via SPARQL', () => {
  test('grantee match included; non-DataAuthorizations type-filtered', async () => {
    sessionMock.setSession(fakeSession())

    sparqlMock.handlers.bindings = (query) => {
      expect(query).toContain('SELECT DISTINCT ?child')
      return [AUTHZ_GRANTEE, AUTHZ_ADMIN].map((iri) => ({
        child: { termType: 'NamedNode', value: iri },
      }))
    }
    sparqlMock.handlers.triples = (query) => {
      const graphs: Record<string, unknown[]> = {
        [AUTHZ_GRANTEE]: authzGraph(
          AUTHZ_GRANTEE,
          INTEROP.DataAuthorization,
          ROLE_ID,
          ALICE
        ),
        [AUTHZ_ADMIN]: authzGraph(
          AUTHZ_ADMIN,
          'https://example/AdminAuthorization',
          ROLE_ID,
          ALICE
        ),
      }
      for (const [iri, quads] of Object.entries(graphs)) {
        if (query.includes(`GRAPH <${iri}>`)) return quads
      }
      throw new Error(`unexpected CONSTRUCT: ${query}`)
    }

    const usage = await findRoleUsage(rolePayload())

    expect(usage).toEqual({
      usedAsGrantee: true,
      affectedGrantees: [],
      authorizations: [{ id: AUTHZ_GRANTEE, type: [INTEROP.DataAuthorization] }],
    })
  })

  test('no match → the role is unused', async () => {
    sessionMock.setSession(fakeSession())

    sparqlMock.handlers.bindings = () => [
      { child: { termType: 'NamedNode', value: AUTHZ_GRANTEE } },
    ]
    sparqlMock.handlers.triples = (query) => {
      if (query.includes(`GRAPH <${AUTHZ_GRANTEE}>`)) {
        return authzGraph(AUTHZ_GRANTEE, INTEROP.DataAuthorization, 'https://bob.example/#id', ALICE)
      }
      throw new Error(`unexpected CONSTRUCT: ${query}`)
    }

    const usage = await findRoleUsage(rolePayload())

    expect(usage).toEqual({
      usedAsGrantee: false,
      affectedGrantees: [],
      authorizations: [],
    })
  })
})

// ──────────────────────────
// findAffectedGrantees — delegation sweep via SPARQL (docs/sparql.md, candidate 3)
// ──────────────────────────

describe('findAffectedGrantees — delegation sweep via SPARQL', () => {
  const PEER = 'https://acme.example/#corp'
  const GRANTEE_A = 'https://bob.example/#id'
  const GRANTEE_B = 'https://jane.example/#id'
  const AUTHZ_DELEG = 'https://auth.alice.example/authz-deleg'
  const AUTHZ_ALL = 'https://auth.alice.example/authz-all'
  const AUTHZ_SELF = 'https://auth.alice.example/authz-self'
  const AUTHZ_ADMIN = 'https://auth.alice.example/authz-admin'
  const ROLE_ID = 'https://auth.alice.example/role/admin'

  const affectedPayload = (roleId?: string) => ({
    webId: { id: ALICE, type: [INTEROP.SocialAgent] } as never,
    peerId: { id: PEER, type: [INTEROP.SocialAgent] } as never,
    roleId: roleId ? ({ id: roleId, type: [INTEROP.Role] } as never) : undefined,
  })

  const routeTriples = (query: string): unknown[] => {
    const graphs: Record<string, unknown[]> = {
      [AUTHZ_DELEG]: authzGraph(AUTHZ_DELEG, INTEROP.DataAuthorization, GRANTEE_A, PEER),
      [AUTHZ_ALL]: authzGraph(
        AUTHZ_ALL,
        INTEROP.DataAuthorization,
        GRANTEE_B,
        'https://other.example/#corp'
      ),
      [AUTHZ_SELF]: authzGraph(AUTHZ_SELF, INTEROP.DataAuthorization, PEER, PEER),
      [AUTHZ_ADMIN]: authzGraph(AUTHZ_ADMIN, 'https://example/AdminAuthorization', GRANTEE_A, PEER),
    }
    for (const [iri, quads] of Object.entries(graphs)) {
      if (query.includes(`GRAPH <${iri}>`)) return quads
    }
    throw new Error(`unexpected CONSTRUCT: ${query}`)
  }

  test('dataOwner and All-scope matches typed and deduped; self-grants and non-DataAuthorizations excluded', async () => {
    sessionMock.setSession(fakeSession())

    sparqlMock.handlers.bindings = () =>
      [AUTHZ_DELEG, AUTHZ_ALL, AUTHZ_SELF, AUTHZ_ADMIN].map((iri) => ({
        child: { termType: 'NamedNode', value: iri },
      }))
    sparqlMock.handlers.triples = routeTriples

    const grantees = await findAffectedGrantees(affectedPayload())

    expect(grantees).toEqual([
      { id: GRANTEE_A, type: [INTEROP.SocialAgent] },
      { id: GRANTEE_B, type: [INTEROP.SocialAgent] },
    ])
  })

  test('with a roleId, All-scope authorizations are no longer matched', async () => {
    sessionMock.setSession(fakeSession())

    sparqlMock.handlers.bindings = () =>
      [AUTHZ_DELEG, AUTHZ_ALL].map((iri) => ({
        child: { termType: 'NamedNode', value: iri },
      }))
    sparqlMock.handlers.triples = routeTriples

    const grantees = await findAffectedGrantees(affectedPayload(ROLE_ID))

    expect(grantees).toEqual([{ id: GRANTEE_A, type: [INTEROP.SocialAgent] }])
  })
})