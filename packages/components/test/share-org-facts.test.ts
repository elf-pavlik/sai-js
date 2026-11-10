import type {
  SparqlTransport,
  DataAuthorizationData,
  DataRegistrationData,
  RoleData,
} from '@janeirodigital/interop-authorization-agent'
import { INTEROP } from '@janeirodigital/interop-utils'
import { ACL } from '@janeirodigital/interop-utils'
import { beforeEach, describe, expect, test, vi } from 'vitest'

// The org context's data plane: every read goes through `queries/org`
// (`/sparql-admin`), so the module is stubbed — this test pins WHICH reads the
// share facts make and what they assemble, not the SPARQL plumbing (covered by
// the AA's `sparql.test.ts`).
vi.mock('../src/services/queries/org.js', () => ({
  containingContainer: vi.fn(),
  contextPod: vi.fn(),
  getDataAuthorization: vi.fn(),
  getDataRegistration: vi.fn(),
  getRole: vi.fn(),
  listContained: vi.fn(),
  listRegistrationsByShapeTrees: vi.fn(),
  sparqlTransportFor: vi.fn(),
  sparqlTransportForPod: vi.fn(),
}))
vi.mock('../src/services/SocialAgentRegistry.js', () => ({
  listSocialAgentRegistrations: vi.fn(),
}))

import type { ResolvedContext } from '../src/services/Context.js'
import {
  containingContainer,
  contextPod,
  getDataAuthorization,
  getDataRegistration,
  getRole,
  listContained,
  listRegistrationsByShapeTrees,
  sparqlTransportFor,
  sparqlTransportForPod,
} from '../src/services/queries/org.js'
import { shareContextFacts } from '../src/services/ShareResource.js'
import { listSocialAgentRegistrations } from '../src/services/SocialAgentRegistry.js'

const OWNER = 'https://id/org' // the org context (data owner)
const ADMIN = 'https://id/admin' // the signed-in admin
const KIM = 'https://id/kim'
const DAN = 'https://id/dan'

const PROJECT_TREE = 'https://data/shapetrees/trees/Project'
const TASK_TREE = 'https://data/shapetrees/trees/Task'
const RESOURCE = 'https://org.data/n3onkx'
const REGISTRATION = 'https://org.data/avn9hv'
const CHILD_REGISTRATION = 'https://org.data/taskreg'
const DATA_POD = 'https://org.data/'
const AUTH_REGISTRY = 'https://registry/org/authorization/'
const ROLE_IRI = 'https://registry/org/role/whiz'

const structure = {
  applicationId: 'https://app.example/',
  resource: RESOURCE,
  accessMode: [ACL.Read],
  children: [{ shapeTree: TASK_TREE, accessMode: [ACL.Read] }],
  agents: [KIM],
}

const registration = {
  id: REGISTRATION,
  registeredShapeTree: PROJECT_TREE,
  partOf: DATA_POD,
} as unknown as DataRegistrationData

const childRegistration = {
  id: CHILD_REGISTRATION,
  registeredShapeTree: TASK_TREE,
  partOf: DATA_POD,
} as unknown as DataRegistrationData

const kimAuthorization = {
  id: 'https://registry/org/authorization/kim',
  type: [INTEROP.DataAuthorization],
  grantee: KIM,
  grantedBy: OWNER,
  registeredShapeTree: PROJECT_TREE,
  scopeOfAuthorization: INTEROP.AllFromRegistry,
  dataOwner: OWNER,
  hasDataRegistration: REGISTRATION,
  accessMode: [ACL.Read],
} as unknown as DataAuthorizationData

/** Role grant over the org's registration: the role is the grantee, so its members bear the access. */
const roleAuthorization = {
  id: 'https://registry/org/authorization/role',
  type: [INTEROP.DataAuthorization],
  grantee: ROLE_IRI,
  grantedBy: OWNER,
  registeredShapeTree: PROJECT_TREE,
  scopeOfAuthorization: INTEROP.AllFromRegistry,
  dataOwner: OWNER,
  hasDataRegistration: REGISTRATION,
  accessMode: [ACL.Read],
} as unknown as DataAuthorizationData

const whiz: RoleData = {
  id: ROLE_IRI,
  type: [INTEROP.Role],
  label: { '@none': 'Whiz' },
  members: [DAN],
}

const podTransport = {} as SparqlTransport
const registryTransport = {} as SparqlTransport

function fakeContext(webId: string, userWebId: string): ResolvedContext {
  return {
    webId,
    userWebId,
    endpoints: new Map([[DATA_POD, 'https://org.data/sparql']]),
    registrySet: {
      hasAuthorizationRegistry: { id: AUTH_REGISTRY },
      hasRoleRegistry: { id: 'https://registry/org/role/' },
    },
  } as unknown as ResolvedContext
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(sparqlTransportForPod).mockReturnValue(podTransport)
  vi.mocked(sparqlTransportFor).mockReturnValue(registryTransport)
  vi.mocked(contextPod).mockReturnValue(DATA_POD)
  vi.mocked(containingContainer).mockResolvedValue(REGISTRATION)
  vi.mocked(getDataRegistration).mockImplementation(async (_transport, iri) =>
    iri === REGISTRATION ? registration : childRegistration
  )
  vi.mocked(listRegistrationsByShapeTrees).mockResolvedValue([CHILD_REGISTRATION])
  // the org's authorization + role registries (container IRI dispatch)
  vi.mocked(listContained).mockImplementation(async (_transport, container) =>
    container === AUTH_REGISTRY ? [kimAuthorization.id!, roleAuthorization.id!] : [ROLE_IRI]
  )
  vi.mocked(getDataAuthorization).mockImplementation(async (_transport, iri) =>
    iri === kimAuthorization.id ? kimAuthorization : roleAuthorization
  )
  vi.mocked(getRole).mockResolvedValue(whiz)
  vi.mocked(listSocialAgentRegistrations).mockResolvedValue([
    { registeredAgent: KIM },
  ] as unknown as Awaited<ReturnType<typeof listSocialAgentRegistrations>>)
})

describe('shareContextFacts', () => {
  test('personal context needs no facts — the session reads its own pods', async () => {
    const facts = await shareContextFacts(fakeContext(ADMIN, ADMIN), structure)
    expect(facts).toBeUndefined()
    expect(containingContainer).not.toHaveBeenCalled()
  })

  test('org context reads the registration, child registrations and access from the context plane', async () => {
    const ctx = fakeContext(OWNER, ADMIN)
    const facts = await shareContextFacts(ctx, structure)

    expect(facts).toBeDefined()
    // the instance's registration comes from the pod's `lws:partOf` (flat
    // storage does not encode the parent in the URI path)
    expect(containingContainer).toHaveBeenCalledWith(ctx, RESOURCE)
    expect(sparqlTransportForPod).toHaveBeenCalledWith(ctx, DATA_POD)
    expect(getDataRegistration).toHaveBeenCalledWith(podTransport, REGISTRATION)
    expect(facts!.dataInstance).toEqual({
      id: RESOURCE,
      shapeTreeIri: PROJECT_TREE,
      dataRegistration: registration,
    })

    // child registrations: one listing over the instance's data registry, then
    // one graph read each
    expect(listRegistrationsByShapeTrees).toHaveBeenCalledWith(podTransport, DATA_POD, [TASK_TREE])
    expect(getDataRegistration).toHaveBeenCalledWith(podTransport, CHILD_REGISTRATION)
    expect(facts!.registrations?.get(TASK_TREE)).toBe(childRegistration)

    // existing access: the registered direct grantee AND the role's members
    // (a role grant is materialized as one grant per member)
    expect([...facts!.agentsWithAccess].toSorted()).toEqual([DAN, KIM])
  })

  test('no children — no child registration read', async () => {
    const ctx = fakeContext(OWNER, ADMIN)
    const facts = await shareContextFacts(ctx, { ...structure, children: [] })
    expect(listRegistrationsByShapeTrees).not.toHaveBeenCalled()
    expect(facts!.registrations?.size).toBe(0)
  })

  test('an instance outside the context pods fails instead of guessing', async () => {
    vi.mocked(containingContainer).mockResolvedValue(undefined)
    await expect(shareContextFacts(fakeContext(OWNER, ADMIN), structure)).rejects.toThrow(
      `cannot resolve the data registration of ${RESOURCE}`
    )
  })

  test('children without a containing data registry fail (lws:partOf is required)', async () => {
    vi.mocked(getDataRegistration).mockResolvedValue({
      id: REGISTRATION,
      registeredShapeTree: PROJECT_TREE,
    } as DataRegistrationData)
    await expect(shareContextFacts(fakeContext(OWNER, ADMIN), structure)).rejects.toThrow(
      `data registration ${REGISTRATION} has no containing data registry (lws:partOf)`
    )
  })
})
