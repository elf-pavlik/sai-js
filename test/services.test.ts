import { describe, expect, test } from 'vitest'

describe('main', () => {
  test('auth', async () => {
    const response = await fetch('https://auth')
    expect(response.ok).toBeTruthy()
  })
  test('registry', async () => {
    const response = await fetch('https://registry')
    expect(response.ok).toBeTruthy()
  })
  test('data', async () => {
    // The data pod advertises its LWS storage description publicly: a request
    // without a storage credential (wildcard/absent Accept) gets the
    // `application/lws+cid` description, not a 401 challenge — the storage
    // root is discoverable without authentication (§5).
    const response = await fetch('https://data/bob/')
    expect(response.ok).toBeTruthy()
    expect(response.headers.get('content-type')).toContain('application/lws+cid')
  })
  test('id', async () => {
    const response = await fetch('https://id/alice')
    expect(response.ok).toBeTruthy()
  })
})
