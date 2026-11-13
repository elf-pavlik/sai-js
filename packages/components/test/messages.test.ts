import { INTEROP } from '@janeirodigital/interop-utils'
import { describe, expect, test } from 'vitest'

import { isAccessRevocationMessage } from '../src/messages.js'

describe('AccessRevocation message', () => {
  test('accepts a valid envelope of grant IRIs', () => {
    const message = {
      type: [INTEROP.AccessRevocationRequest],
      grants: ['https://registry/acme/g1', 'https://registry/acme/g2'],
    }
    expect(isAccessRevocationMessage(message)).toBe(true)
  })

  test('rejects non-string grants and wrong type', () => {
    expect(
      // @ts-expect-error — deliberately malformed payload
      isAccessRevocationMessage({
        type: [INTEROP.AccessRevocationRequest],
        grants: ['g1', 42],
      })
    ).toBe(false)
    expect(isAccessRevocationMessage({ type: [INTEROP.AccessRequest], grants: [] })).toBe(false)
  })
})
