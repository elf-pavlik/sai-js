import { randomUUID } from 'node:crypto'
import { fetch } from '@janeirodigital/interop-test-utils'
import { loader } from '@janeirodigital/interop-utils'
import { describe, test } from 'vitest'
import { WebIdProfile } from '../../src'
const loadWebIdProfile = loader(WebIdProfile.fromJsonLd)

import { expect } from '../expect'

const deps = { fetch, randomUUID }
const webId = 'https://alice.example/#id'

describe('getters', () => {
  test('label', async () => {
    const webIdProfile = await loadWebIdProfile(webId, deps.fetch)
    expect(webIdProfile.label).toBe('Alice')
  })

  test.todo('oidcIssuer')
})
