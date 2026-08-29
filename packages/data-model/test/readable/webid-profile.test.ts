import { randomUUID } from 'node:crypto'
import { fetch } from '@janeirodigital/interop-test-utils'
import { describe, test } from 'vitest'
import { WebIdProfile } from '../../src'
import { expect } from '../expect'

const deps = { fetch, randomUUID }
const webId = 'https://alice.example/#id'

describe('getters', () => {
  test('label', async () => {
    const webIdProfile = await WebIdProfile.loadWebIdProfile(webId, deps.fetch)
    expect(webIdProfile.label).toBe('Alice')
  })

  test.todo('oidcIssuer')
})
