import { randomUUID } from 'node:crypto'
import { createStatefulFetch, fetch } from '@janeirodigital/interop-test-utils'
import { INTEROP, asyncIterableToArray } from '@janeirodigital/interop-utils'
import { describe, test } from 'vitest'
import { AuthorizationAgentFactory, AuthorizationRegistry } from '../../src'
import { expect } from '../expect'

const factory = new AuthorizationAgentFactory({ fetch, randomUUID })

const mixedRegistry = { id: 'https://auth.alice.example/authorization-registry-mixed' }
const adminOnlyRegistry = { id: 'https://auth.alice.example/authorization-registry-admin-only' }

describe('type-filtered authorization iterators', () => {
  test('dataAuthorizations returns only DataAuthorizations', async () => {
    const result = await asyncIterableToArray(
      AuthorizationRegistry.dataAuthorizations(mixedRegistry, factory)
    )
    expect(result).toHaveLength(2)
    for (const dataAuthorization of result) {
      expect(dataAuthorization.type).toContain(INTEROP.DataAuthorization)
      expect(dataAuthorization.type).not.toContain(INTEROP.AdminAuthorization)
    }
  })

  test('getDataAuthorizations returns only DataAuthorizations', async () => {
    const result = await AuthorizationRegistry.getDataAuthorizations(mixedRegistry, factory)
    expect(result).toHaveLength(2)
    for (const dataAuthorization of result) {
      expect(dataAuthorization.type).toContain(INTEROP.DataAuthorization)
    }
  })

  test('findDataAuthorizations returns only matching DataAuthorizations', async () => {
    const result = await AuthorizationRegistry.findDataAuthorizations(
      mixedRegistry,
      factory,
      'https://acme.example/#corp'
    )
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('https://auth.alice.example/authorization-registry-mixed/data-auth-1')
  })

  test('findAuthorizationsDelegatingFromOwner excludes AdminAuthorizations', async () => {
    const result = await AuthorizationRegistry.findAuthorizationsDelegatingFromOwner(
      mixedRegistry,
      factory,
      'https://alice.example/#id',
      ''
    )
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('https://auth.alice.example/authorization-registry-mixed/data-auth-2')
  })

  test('registry holding only AdminAuthorizations yields empty results for all four', async () => {
    expect(
      await asyncIterableToArray(
        AuthorizationRegistry.dataAuthorizations(adminOnlyRegistry, factory)
      )
    ).toEqual([])
    expect(await AuthorizationRegistry.getDataAuthorizations(adminOnlyRegistry, factory)).toEqual(
      []
    )
    expect(
      await AuthorizationRegistry.findDataAuthorizations(
        adminOnlyRegistry,
        factory,
        'https://id/dan'
      )
    ).toEqual([])
    expect(
      await AuthorizationRegistry.findAuthorizationsDelegatingFromOwner(
        adminOnlyRegistry,
        factory,
        'https://id/yoyo',
        ''
      )
    ).toEqual([])
  })
})

describe('AdminAuthorization crud (R1 internal read + write)', () => {
  test('recordAdminAuthorization writes the AdminAuthorization resource', async () => {
    const statefulFetch = createStatefulFetch()
    const statefulFactory = new AuthorizationAgentFactory({ fetch: statefulFetch, randomUUID })

    const recorded = await AuthorizationRegistry.recordAdminAuthorization(
      mixedRegistry,
      statefulFactory,
      {
        grantee: 'https://id/eve',
        grantedBy: 'https://id/yoyo',
        scopeOfAuthorization: INTEROP.All,
      }
    )

    expect(recorded.id).toMatch(/^https:\/\/auth\.alice\.example\/authorization-registry-mixed/)
    expect(recorded.type).toEqual([INTEROP.AdminAuthorization])
    expect(recorded.grantee).toBe('https://id/eve')
    expect(recorded.grantedBy).toBe('https://id/yoyo')
    expect(recorded.scopeOfAuthorization).toBe(INTEROP.All)

    // the written resource carries the expected predicates
    const doc = JSON.parse(await (await statefulFetch(recorded.id)).text())
    const node = Array.isArray(doc) ? doc.find((n) => n['@id'] === recorded.id) : doc
    expect(node['@type']).toContain(INTEROP.AdminAuthorization)
    expect(node[`${INTEROP.namespace}grantee`][0]['@id']).toBe('https://id/eve')
    expect(node[`${INTEROP.namespace}grantedBy`][0]['@id']).toBe('https://id/yoyo')
    expect(node[`${INTEROP.namespace}scopeOfAuthorization`][0]['@id']).toBe(INTEROP.All)
  })

  test('findAdminAuthorization returns the admin authorization for the grantee', async () => {
    const result = await AuthorizationRegistry.findAdminAuthorization(
      mixedRegistry,
      factory,
      'https://id/dan'
    )
    expect(result).toBeDefined()
    expect(result!.type).toContain(INTEROP.AdminAuthorization)
    expect(result!.grantee).toBe('https://id/dan')
    expect(result!.grantedBy).toBe('https://id/yoyo')
    expect(result!.scopeOfAuthorization).toBe(INTEROP.All)
  })

  test('findAdminAuthorization returns undefined for an agent without one', async () => {
    const result = await AuthorizationRegistry.findAdminAuthorization(
      mixedRegistry,
      factory,
      'https://id/nobody'
    )
    expect(result).toBeUndefined()
  })

  test('adminAuthorizations yields only AdminAuthorizations', async () => {
    const result = await asyncIterableToArray(
      AuthorizationRegistry.adminAuthorizations(mixedRegistry, factory)
    )
    expect(result).toHaveLength(1)
    for (const adminAuthorization of result) {
      expect(adminAuthorization.type).toContain(INTEROP.AdminAuthorization)
      expect(adminAuthorization.type).not.toContain(INTEROP.DataAuthorization)
    }
  })

  test('deleteAdminAuthorization removes the resource', async () => {
    const statefulFetch = createStatefulFetch()
    const statefulFactory = new AuthorizationAgentFactory({ fetch: statefulFetch, randomUUID })

    const recorded = await AuthorizationRegistry.recordAdminAuthorization(
      mixedRegistry,
      statefulFactory,
      {
        grantee: 'https://id/eve',
        grantedBy: 'https://id/yoyo',
        scopeOfAuthorization: INTEROP.All,
      }
    )
    await AuthorizationRegistry.deleteAdminAuthorization(recorded.id, statefulFactory)
    await expect(statefulFetch(recorded.id).then((response) => response.text())).rejects.toThrow(
      'missing snippet'
    )
  })
})
