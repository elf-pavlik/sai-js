import { ACL, INTEROP } from '@janeirodigital/interop-utils'
import { describe, expect, test } from 'vitest'
import { isAccessRequestMessage, isAccessRevocationMessage } from '../src/messages.js'

const grant = {
  type: [INTEROP.DataGrant],
  grantee: 'https://id/bob',
  grantedBy: 'https://id/acme',
  dataOwner: 'https://id/acme',
  registeredShapeTree: 'https://data/shapetrees/trees/Project',
  hasDataRegistration: 'https://data/acme-rnd/reb39k/',
  hasStorage: 'https://data/acme-rnd/',
  scopeOfGrant: INTEROP.AllFromRegistry,
  accessMode: [ACL.Read],
}

describe('AccessRequest message', () => {
  test('accepts a valid envelope with embedded inheriting children', () => {
    const message = {
      type: [INTEROP.AccessRequest],
      grants: [
        {
          ...grant,
          hasInheritingGrant: [
            {
              ...grant,
              scopeOfGrant: INTEROP.Inherited,
              hasDataRegistration: 'https://data/acme-rnd/x0md9s/',
            },
          ],
        },
      ],
    }
    expect(isAccessRequestMessage(message)).toBe(true)
  })

  test('accepts a single-string type', () => {
    expect(isAccessRequestMessage({ type: INTEROP.AccessRequest, grants: [grant] })).toBe(true)
  })

  test('rejects wrong type and missing grants', () => {
    expect(isAccessRequestMessage({ type: [INTEROP.AccessRevocation], grants: [] })).toBe(false)
    expect(isAccessRequestMessage({ type: [INTEROP.AccessRequest] })).toBe(false)
    expect(isAccessRequestMessage(null)).toBe(false)
  })
})

describe('AccessRevocation message', () => {
  test('accepts a valid envelope of grant IRIs', () => {
    const message = {
      type: [INTEROP.AccessRevocation],
      grants: ['https://registry/acme/grant/g1', 'https://registry/acme/grant/g2'],
    }
    expect(isAccessRevocationMessage(message)).toBe(true)
  })

  test('rejects non-string grants and wrong type', () => {
    expect(
      // @ts-expect-error — deliberately malformed payload
      isAccessRevocationMessage({
        type: [INTEROP.AccessRevocation],
        grants: ['g1', 42],
      })
    ).toBe(false)
    expect(isAccessRevocationMessage({ type: [INTEROP.AccessRequest], grants: [] })).toBe(false)
  })
})